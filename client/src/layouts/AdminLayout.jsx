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
import ReceptionSidebarNav from './ReceptionSidebarNav';
import { useReceptionPolling } from '../features/home/reception/receptionDashboard';
import SlidingIndicator from '../motion/SlidingIndicator';
import PageTransition from '../motion/PageTransition';
import { springConfig } from '../motion/presets';

const WIDE = 248;
const WIDE_RECEPTION = 260;
const NARROW = 72;

/** Gom mục menu được phép xem theo nhóm, giữ thứ tự MENU_GROUPS */
function useGroupedMenu() {
  const { canSee } = useAuth();
  const visible = adminMenu.filter((item) => !item.hideInMenu && canSee(item));
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
            <div className="px-2.5 py-1 text-[11px] font-medium tracking-wider uppercase text-ink-3 dark:text-[#8B8B94] select-none">
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
                    active ? 'text-ink dark:text-white' : 'text-ink-2 hover:text-ink hover:bg-surface-alt dark:text-[#A1A1AA] dark:hover:text-white dark:hover:bg-[#27272A]'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  {item.icon && (
                    <span className={`text-base shrink-0 ${active ? 'text-navy dark:text-[#60A5FA]' : 'text-ink-3'}`}>
                      {createElement(item.icon)}
                    </span>
                  )}
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {active && (
                  <SlidingIndicator
                    layoutId="sidebar-active"
                    className="absolute inset-0 z-0 rounded-md border-l-2 border-navy bg-surface-alt dark:bg-[#27272A] dark:border-[#60A5FA]"
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
          <span className="block text-sm font-semibold tracking-tight text-ink dark:text-white leading-none">SAPMS</span>
          <span className="block text-[10px] text-ink-3 tracking-wider uppercase font-medium mt-1">
            Quản lý chung cư
          </span>
        </span>
      )}
    </Link>
  );
}

// Layout nội bộ (STAFF / ACCOUNTANT / MANAGER / BOARD) — hệ giao diện A "Gọn sáng", kiểu khung nổi tách rời:
// sidebar, thanh trên và nội dung là 3 khung trắng bo góc cách nhau 12px trên nền xám. Sidebar thu gọn được còn cột icon.
// Menu sinh từ config/menu.js (lọc theo quyền, gom theo group); đổi trang có morph (view transition).
export default function AdminLayout() {
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { isDark, toggle } = useThemeMode();
  const { pathname } = useLocation();
  // Lễ tân có giao diện riêng (trang chủ mới, sidebar nhóm lại + badge, header cao hơn); các vai trò khác giữ nguyên
  const { hasRole } = useAuth();
  const isReception = hasRole('STAFF:RECEPTIONIST');
  const wide = isReception ? WIDE_RECEPTION : WIDE;
  useReceptionPolling(isReception);

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
      <div className={`h-14 flex items-center px-4 border-b border-line dark:border-[#2E2E33] shrink-0 ${narrow ? 'justify-center px-0' : ''}`}>
        <SidebarBrand collapsed={narrow} />
      </div>
      {isReception ? (
        <ReceptionSidebarNav collapsed={narrow} onNavigate={() => setDrawerOpen(false)} />
      ) : (
        <SidebarNav collapsed={narrow} onNavigate={() => setDrawerOpen(false)} />
      )}
      {/* Nút thu gọn / mở rộng ở đáy sidebar: thu gọn còn cột icon để nhường chỗ cho bảng rộng */}
      {!isMobile && (
        <div className="shrink-0 border-t border-line dark:border-[#2E2E33] p-2">
          <Tooltip title={narrow ? 'Mở rộng menu' : undefined} placement="right">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className={`w-full h-9 rounded-md flex items-center gap-2.5 px-3 border-0 bg-transparent text-[13px] font-medium text-ink-2 hover:text-ink hover:bg-surface-alt dark:text-[#A1A1AA] dark:hover:text-white dark:hover:bg-[#27272A] transition-colors cursor-pointer ${
                narrow ? 'justify-center px-0' : ''
              }`}
              aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <MenuUnfoldOutlined className="text-base" /> : <MenuFoldOutlined className="text-base" />}
              {!narrow && <span>Thu gọn menu</span>}
            </button>
          </Tooltip>
        </div>
      )}
    </>
  );

  return (
    <div className={`min-h-screen flex gap-3 p-2 lg:p-3 dark:bg-[#09090B] ${isReception ? 'bg-r-bg' : 'bg-ivory'}`}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          size={`min(${wide}px, 85vw)`}
          closable={false}
          styles={{ body: { padding: 0, background: isDark ? '#111113' : '#FFFFFF', display: 'flex', flexDirection: 'column' } }}
        >
          {sidebarInner(false)}
        </Drawer>
      ) : (
        <motion.aside
          animate={{ width: collapsed ? NARROW : wide }}
          transition={springConfig}
          className="h-[calc(100vh-24px)] sticky top-3 flex flex-col overflow-hidden rounded-2xl border border-line shadow-float shrink-0 select-none z-30 bg-white dark:bg-[#18181B] dark:border-[#2E2E33]"
        >
          {sidebarInner(collapsed)}
        </motion.aside>
      )}

      <div className="flex-1 flex flex-col gap-2 lg:gap-3 min-w-0">
        {/* Lớp nền phía sau thanh trên: nội dung cuộn lên không lộ ra trong khe 12px phía trên khung */}
        <div className={`sticky top-0 z-20 -mt-2 pt-2 lg:-mt-3 lg:pt-3 dark:bg-[#09090B] ${isReception ? 'bg-r-bg' : 'bg-ivory'}`}>
        <header
          className={`rounded-2xl border shadow-float px-3 md:px-4 flex items-center justify-between gap-3 bg-white/95 dark:bg-[#18181B]/95 dark:border-[#2E2E33] backdrop-blur-sm ${
            isReception ? 'h-16 border-r-border' : 'h-14 border-line'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
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
              aria-label={isReception ? 'Tìm chức năng, cư dân, căn hộ' : 'Tìm chức năng'}
              className={`flex items-center gap-2.5 px-3 border cursor-pointer transition-colors dark:bg-[#27272A] dark:border-[#2E2E33] dark:text-[#A1A1AA] ${
                isReception
                  ? 'h-11 w-full max-w-[620px] rounded-[10px] text-sm bg-white border-r-border-control text-r-subtle hover:border-r-muted'
                  : 'py-1.5 rounded-md text-xs bg-ivory border-line text-ink-2 hover:bg-surface-alt'
              }`}
            >
              <SearchOutlined className="text-ink-3" />
              <span className={`hidden sm:inline ${isReception ? 'flex-1 text-left' : ''}`}>
                {isReception ? 'Tìm chức năng, cư dân, căn hộ' : 'Tìm chức năng…'}
              </span>
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
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-2 hover:bg-surface-alt dark:text-[#A1A1AA] dark:hover:bg-[#27272A] cursor-pointer"
                aria-label="Đổi chế độ sáng/tối"
              >
                {isDark ? <SunOutlined className="text-gold" /> : <MoonOutlined />}
              </button>
            </Tooltip>
            <NotificationBell area="app" variant={isReception ? 'resident' : undefined} />
            <span className="h-5 w-px bg-line dark:bg-[#2E2E33]" />
            <UserMenu compact={isMobile} variant={isReception ? 'reception' : undefined} />
          </div>
        </header>
        </div>

        <main className="flex-1 w-full min-w-0 rounded-2xl border border-line shadow-float bg-white dark:bg-[#18181B] dark:border-[#2E2E33] px-[clamp(12px,2.2vw,28px)] py-[clamp(12px,2.5vh,24px)]">
          <Suspense fallback={<PageLoader />}>
            <PageTransition key={pathname} className="page-stack">
              <Outlet />
            </PageTransition>
          </Suspense>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
