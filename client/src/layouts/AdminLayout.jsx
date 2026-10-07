import { Suspense, createElement, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Drawer, Grid, Tooltip } from 'antd';
import { MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, MoonOutlined, SearchOutlined, SunOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import { MENU_GROUPS, adminMenu } from '../config/menu';
import { useAuth } from '../hooks/useAuth';
import { useThemeMode } from '../hooks/useThemeMode';
import UserMenu from '../components/UserMenu';
import PageLoader from '../components/PageLoader';
import BrandLogo from '../components/BrandLogo';
import CommandPalette from '../components/CommandPalette';
import NotificationBell from '../features/notifications/NotificationBell';
import SlidingIndicator from '../motion/SlidingIndicator';
import PageTransition from '../motion/PageTransition';
import { springConfig } from '../motion/presets';

const WIDE = 248;
const NARROW = 72;

/** Gom mục menu được phép xem theo nhóm, giữ thứ tự MENU_GROUPS */
function useGroupedMenu() {
  const { hasRole } = useAuth();
  const visible = adminMenu.filter((item) => !item.hideInMenu && hasRole(...(item.roles ?? [])));
  return MENU_GROUPS.map((group) => ({
    group,
    items: visible.filter((item) => (item.group ?? MENU_GROUPS[0]) === group),
  })).filter((g) => g.items.length);
}

function SidebarNav({ collapsed, onNavigate }) {
  const { pathname } = useLocation();
  const activeKey = pathname.split('/')[2];
  const groups = useGroupedMenu();

  return (
    <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4" aria-label="Menu chính">
      {groups.map(({ group, items }) => (
        <div key={group} className="space-y-1">
          {!collapsed && (
            <div className="px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase text-gold/70 select-none">
              {group}
            </div>
          )}
          {items.map((item) => {
            // Trang chi tiết (assets/:id) vẫn sáng mục cha "assets"
            const active = activeKey === item.path.split('/')[0];
            const link = (
              <Link
                key={item.key}
                to={`/app/${item.path}`}
                viewTransition
                onClick={onNavigate}
                className="relative block no-underline"
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className={`relative z-10 flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                    active ? 'text-white' : 'text-side-text hover:text-white hover:bg-side-hover'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  {item.icon && (
                    <span className={`text-base shrink-0 ${active ? 'text-gold' : 'text-ink-3'}`}>
                      {createElement(item.icon)}
                    </span>
                  )}
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {active && (
                  <SlidingIndicator
                    layoutId="sidebar-active"
                    className="absolute inset-0 z-0 rounded-md border-l-[3px] border-gold bg-[rgba(201,163,91,0.12)]"
                  />
                )}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.key} title={item.label} placement="right">
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarBrand({ collapsed }) {
  return (
    <Link to="/app/home" viewTransition className="flex items-center gap-3 overflow-hidden no-underline">
      <BrandLogo size={32} />
      {!collapsed && (
        <span className="vt-brand-title whitespace-nowrap">
          <span className="block text-sm font-bold tracking-tight text-white leading-none">SAPMS</span>
          <span className="block text-[10px] text-gold tracking-wider uppercase font-medium mt-1">
            Quản lý chung cư
          </span>
        </span>
      )}
    </Link>
  );
}

// Layout nội bộ (STAFF / ACCOUNTANT / MANAGER / BOARD / ADMIN) — phong cách "Midnight & Champagne".
// Menu sinh từ config/menu.js (lọc theo quyền, gom theo group); đổi trang có morph (view transition).
export default function AdminLayout() {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { isDark, toggle } = useThemeMode();
  const { pathname } = useLocation();

  // Ctrl+K / ⌘K mở tìm kiếm nhanh
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sidebarInner = (narrow) => (
    <>
      <div className="h-16 flex items-center justify-between px-4 border-b border-side-line shrink-0">
        <SidebarBrand collapsed={narrow} />
        {!isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="w-7 h-7 rounded flex items-center justify-center text-ink-3 hover:text-white hover:bg-side-line transition-colors cursor-pointer"
            aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        )}
      </div>
      <SidebarNav collapsed={narrow} onNavigate={() => setDrawerOpen(false)} />
    </>
  );

  return (
    <div className="min-h-screen flex bg-ivory dark:bg-[#0B1422]">
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          size={WIDE}
          closable={false}
          styles={{ body: { padding: 0, background: '#0F1B2D', display: 'flex', flexDirection: 'column' } }}
        >
          {sidebarInner(false)}
        </Drawer>
      ) : (
        <motion.aside
          animate={{ width: collapsed ? NARROW : WIDE }}
          transition={springConfig}
          className="h-screen sticky top-0 flex flex-col bg-midnight border-r border-side-line shrink-0 select-none z-30"
        >
          {sidebarInner(collapsed)}
        </motion.aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 sticky top-0 z-20 border-b px-4 md:px-6 flex items-center justify-between gap-3 bg-white/95 border-line dark:bg-[#121E31]/95 dark:border-[#24344D] backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="w-9 h-9 rounded-md flex items-center justify-center text-ink-2 hover:bg-surface-alt cursor-pointer"
                aria-label="Mở menu"
              >
                <MenuOutlined />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors bg-ivory border-line text-ink-2 hover:bg-surface-alt dark:bg-[#18263D] dark:border-[#24344D] dark:text-[#A7B0BF]"
            >
              <SearchOutlined className="text-ink-3" />
              <span className="hidden sm:inline">Tìm chức năng…</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-white border border-line-strong rounded text-ink-3 dark:bg-transparent">
                Ctrl K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip title={isDark ? 'Chế độ sáng' : 'Chế độ tối'}>
              <button
                type="button"
                onClick={toggle}
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-2 hover:bg-surface-alt dark:text-[#A7B0BF] dark:hover:bg-[#18263D] cursor-pointer"
                aria-label="Đổi chế độ sáng/tối"
              >
                {isDark ? <SunOutlined className="text-gold" /> : <MoonOutlined />}
              </button>
            </Tooltip>
            <NotificationBell area="app" />
            <span className="h-5 w-px bg-line dark:bg-[#24344D]" />
            <UserMenu compact={isMobile} />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 w-full max-w-[1400px] mx-auto">
          <Suspense fallback={<PageLoader />}>
            <PageTransition key={pathname}>
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
