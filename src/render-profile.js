// Preserve the original visual quality on both phones and desktops.
export const renderProfile = {
  pixelRatio: typeof window !== "undefined" && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 1.25) : 1.0,
  antialias: true,
  shadowSize: 1536,
  detailedFoliage: true,
  leafCards: 80,
  anisotropy: 4,
};
