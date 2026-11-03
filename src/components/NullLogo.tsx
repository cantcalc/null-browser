import logoUrl from '../../assets/icon.png';
import privateLogoUrl from '../../assets/private-logo.png';

/** Private New Tab opts into its own mark; other brand surfaces use the normal logo. */
export function NullLogo({ className = '', size = 36, variant = 'default' }: { className?: string; size?: number; variant?: 'default' | 'private' }) {
  const isPrivate = variant === 'private';
  return <img src={isPrivate ? privateLogoUrl : logoUrl} width={size} height={size}
    alt={isPrivate ? 'NULL 시크릿' : 'NULL'} draggable={false}
    data-null-logo={isPrivate ? 'null-private' : 'null-monochrome'} className={`null-brand-logo ${className}`} />;
}
