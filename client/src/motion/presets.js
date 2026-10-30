/**
 * @file presets.js
 * @description Các cấu hình transition và animation variants chuẩn của hệ thống SAPMS.
 * Đáp ứng tiêu chuẩn: PowerPoint Morph Transition (550ms, cubic-bezier(0.65, 0, 0.35, 1)).
 */

const morphEase = [0.65, 0, 0.35, 1];

export const springConfig = {
  type: 'spring',
  stiffness: 340,
  damping: 30,
};

const tweenFast = {
  type: 'tween',
  duration: 0.25,
  ease: morphEase,
};

const tweenNormal = {
  type: 'tween',
  duration: 0.55,
  ease: morphEase,
};

export const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: tweenNormal,
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: tweenFast,
  },
};
