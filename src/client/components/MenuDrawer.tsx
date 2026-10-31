import { useEffect, useRef, type PropsWithChildren } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from '../i18n.js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function getVisibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0
  );
}

export function MenuDrawer({
  open,
  onClose,
  children,
}: PropsWithChildren<{
  open: boolean;
  onClose: () => void;
}>): React.ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const active = document.activeElement;
      previousFocusRef.current = active instanceof HTMLElement ? active : null;
      const frame = window.requestAnimationFrame(() => {
        closeRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target =
        (previousFocusRef.current && document.body.contains(previousFocusRef.current)
          ? previousFocusRef.current
          : null) ?? document.querySelector<HTMLElement>('[data-menu-trigger="true"]');
      window.requestAnimationFrame(() => {
        target?.focus({ preventScroll: true });
      });
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = getVisibleFocusable(drawerRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? drawerRef.current.contains(current) : false;

      if (event.shiftKey) {
        if (!inside || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, open]);

  if (!open) return null;

  const isMenuIndex = location.pathname === '/more';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        id="app-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('menuDrawerTitle')}
        className="glass-drawer relative z-10 h-[100dvh] w-full max-w-[480px] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {!isMenuIndex ? (
              <Link
                to={{ pathname: '/more', search: location.search }}
                className="glass-control-btn min-h-[44px] px-3 rounded-xl inline-flex items-center gap-1.5 text-sm font-semibold text-slate-100"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t('backToMenu')}</span>
              </Link>
            ) : (
              <span className="text-sm font-semibold text-sky-300 tracking-wide px-1">
                {t('menuDrawerTitle')}
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('closeDrawer')}
            className="glass-control-btn min-h-[44px] min-w-[44px] px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-100"
          >
            <X className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>ESC</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 drawer-scroll-body">
          {children}
        </div>
      </div>
    </div>
  );
}

