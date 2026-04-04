/**
 * Shared auth-type icon helper.
 * Returns { label, svg } for a given auth type string.
 * Used by UserListView (inline card icons) and UserDetailView (detail panel icons).
 */
export function getAuthIcon(authType) {
    const type = (authType || '').toLowerCase();

    if (type === 'google') {
        return {
            label: 'Google',
            svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285f4" d="M23.49 12.27c0-.79-.07-1.54-.21-2.27H12v4.3h6.44c-.28 1.38-1.09 2.55-2.32 3.34v2.77h3.75c2.2-2.03 3.62-5.02 3.62-8.14z"/>
                <path fill="#34a853" d="M12 24c3.15 0 5.8-1.04 7.73-2.86l-3.75-2.77c-1.04.7-2.37 1.11-3.98 1.11-3.06 0-5.64-2.06-6.57-4.84H1.56v3.03C3.47 21.43 7.43 24 12 24z"/>
                <path fill="#fbbc04" d="M5.43 14.64c-.23-.7-.36-1.44-.36-2.21s.13-1.51.36-2.21V7.19H1.56A11.98 11.98 0 0 0 0 12.43c0 1.94.46 3.77 1.56 5.24l3.87-3.03z"/>
                <path fill="#ea4335" d="M12 4.73c1.71 0 3.24.6 4.45 1.77l3.3-3.3C17.79 1.3 15.15 0 12 0 7.43 0 3.47 2.57 1.56 6.19l3.87 3.03C6.36 6.79 8.94 4.73 12 4.73z"/>
            </svg>`
        };
    }

    if (type === 'apple') {
        return {
            label: 'Apple',
            svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M16.39 12.27c.03 2.75 2.41 3.66 2.44 3.68-.02.06-.38 1.33-1.27 2.63-.77 1.12-1.57 2.23-2.83 2.25-1.24.02-1.64-.73-3.06-.73-1.42 0-1.86.71-3.03.75-1.22.05-2.16-1.23-2.94-2.35-1.6-2.32-2.83-6.56-1.18-9.42.82-1.42 2.29-2.32 3.88-2.34 1.21-.02 2.35.82 3.06.82.71 0 2.05-1.01 3.46-.86.59.03 2.23.24 3.29 1.81-.09.06-1.96 1.14-1.94 3.76zm-2.28-6.65c.64-.78 1.07-1.88.95-2.98-.92.04-2.04.61-2.7 1.39-.59.68-1.1 1.78-.96 2.84 1.03.08 2.07-.52 2.71-1.25z"/>
            </svg>`
        };
    }

    const label = type === 'email' ? 'Email' : (authType || 'Unknown');
    return {
        label,
        svg: `<svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.511l8 5.333 8-5.333V7H4zm16 10V9.489l-8 5.334-8-5.334V17h16z"/>
        </svg>`
    };
}
