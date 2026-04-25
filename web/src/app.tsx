import { Footer } from './components/layout/footer';
import { Header } from './components/layout/header';

export function App() {
  return (
    <div className="app">
      <Header />
      <main className="app__main">
        <section className="placeholder">
          <h1>CostCompare</h1>
          <p>
            A patient-submitted database of cash-pay prices for medical procedures, alongside
            Medicare rates for context.
          </p>
          <p className="placeholder__status">
            Submission and search features are coming online in upcoming issues.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
