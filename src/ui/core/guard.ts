import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useApp } from './app';

/**
 * Avertissement en cas de modifications non enregistrées : navigation interne
 * (bloquée avec confirmation) et fermeture de la fenêtre.
 */
export function useLeaveGuard(dirty: boolean) {
  const { confirm } = useApp();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirm({
      title: 'Modifications non enregistrées',
      message: 'Vous avez des modifications non enregistrées. Quitter cette page sans enregistrer ?',
      confirmLabel: 'Quitter sans enregistrer',
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}
