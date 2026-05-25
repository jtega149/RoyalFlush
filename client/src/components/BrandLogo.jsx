import { Link } from 'react-router-dom';
import royalFlushLogo from '../assets/royal_flush_logo.png';

export default function BrandLogo() {
  return (
    <Link to="/" className="brand-logo-link" aria-label="Royal Flush home">
      <img src={royalFlushLogo} alt="" className="brand-logo-image" />
    </Link>
  );
}
