// kit-marca-v1 §2: tipos e limites de cada asset do kit da marca (conferidos no POST /uploads e no complete).
export const BRAND_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const BRAND_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const BRAND_FILE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const BRAND_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const BRAND_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
/** vídeo demo: o teto de bytes é o mesmo do campeão (AppConfig.uploadMaxBytes); duração 1 s a 10 min */
export const BRAND_VIDEO_MIN_SEC = 1;
export const BRAND_VIDEO_MAX_SEC = 600;
/** quantos de cada por cliente (LOGO = 1, trocado no POST) */
export const BRAND_MAX_FILES = 30;
export const BRAND_MAX_DEMO_VIDEOS = 5;
export const BRAND_LABEL_MAX = 80;
