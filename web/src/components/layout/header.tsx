import { NavLink } from 'react-router-dom';

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <NavLink className="site-header__brand" to="/">
          CostCompare
        </NavLink>
        <nav className="site-header__nav" aria-label="Primary">
          <NavLink to="/" end className="site-header__link">
            Search
          </NavLink>
          <NavLink to="/submit" className="site-header__link">
            Submit a price
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
