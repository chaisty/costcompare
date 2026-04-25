export function Footer() {
  return (
    <footer className="site-footer" aria-label="Site disclaimers">
      <div className="site-footer__inner">
        <h2 className="site-footer__heading">Important</h2>
        <ul className="site-footer__disclaimers">
          <li>
            CostCompare is <strong>not medical, legal, or financial advice</strong>. Prices shown
            are for informational and comparison purposes only.
          </li>
          <li>
            Cash-pay prices are <strong>submitted by individual patients</strong> and are not
            verified by the facilities they reference. Actual charges may differ.
          </li>
          <li>
            Medicare and payer-negotiated rates are derived from publicly available CMS and
            Transparency-in-Coverage data with a <strong>best-effort caveat</strong>. Every rate row
            displays its source and year.
          </li>
          <li>
            CostCompare is <strong>not affiliated with</strong> CMS, any insurance payer, or any
            healthcare provider.
          </li>
        </ul>
      </div>
    </footer>
  );
}
