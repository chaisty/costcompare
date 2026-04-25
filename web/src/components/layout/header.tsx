export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-header__brand" href="/">
          CostCompare
        </a>
        <nav className="site-header__nav" aria-label="Primary">
          {/* Navigation will be added alongside the search and submit flows. */}
        </nav>
      </div>
    </header>
  );
}
