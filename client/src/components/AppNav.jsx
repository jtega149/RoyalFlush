import { useEffect, useRef, useState } from 'react';

export default function AppNav({ children, menuLabel = 'Account menu' }) {
  const [open, setOpen] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!navRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <nav className="app-nav" ref={navRef}>
      <button
        type="button"
        className="app-nav-toggle"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={menuLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="app-nav-toggle-icon" aria-hidden="true" />
      </button>
      <div className={`app-nav-dropdown${open ? ' is-open' : ''}`}>
        <div className="user-links" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      </div>
    </nav>
  );
}
