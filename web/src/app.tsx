import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { Footer } from './components/layout/footer';
import { Header } from './components/layout/header';
import { ConfirmPage } from './pages/confirm';
import { SubmitPage } from './pages/submit';

function Layout() {
  return (
    <div className="app">
      <Header />
      <main className="app__main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SubmitPage />} />
          <Route path="confirm" element={<ConfirmPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
