/** The UI Builder mark: a form sheet on a gradient tile. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden="true">
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h4" />
      </svg>
    </span>
  );
}

/** The Anduin mark (as on anduintransact.com), for the start page. */
export function AnduinMark({ height = 30 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 41 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Anduin">
      <path d="M20.4519 0L18.3227 3.37486L0 31.6525H8.27027C9.62109 29.5532 10.9735 27.4524 12.3243 25.3532C13.6751 27.4524 15.0276 29.5532 16.3784 31.6525L24.4589 31.6667C25.873 29.5091 27.2887 27.3532 28.7027 25.1957C30.0535 27.3485 31.406 29.4997 32.7568 31.6525H40.8649C34.0606 21.1011 27.2562 10.5514 20.4519 0ZM20.4324 25.0382C19.7303 23.9752 19.0265 22.8728 18.3243 21.7311C17.7016 20.7185 17.1065 19.72 16.5405 18.7389C17.8378 16.6396 19.1351 14.5388 20.4324 12.4396C21.7297 14.5388 23.027 16.6396 24.3243 18.7389C23.027 20.8381 21.7297 22.939 20.4324 25.0382Z" fill="#48AFF0" />
    </svg>
  );
}
