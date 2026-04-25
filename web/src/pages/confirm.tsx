import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type ConfirmErrorCode, confirmSubmission } from '../lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'missing-token' }
  | { kind: 'network-error' }
  | { kind: 'error'; code: ConfirmErrorCode };

function heading(state: State): string {
  switch (state.kind) {
    case 'loading':
      return 'Confirming your submission…';
    case 'success':
      return 'Submission confirmed';
    case 'missing-token':
      return 'Missing confirmation token';
    case 'network-error':
      return 'Could not reach CostCompare';
    case 'error':
      switch (state.code) {
        case 'invalid_token':
          return 'This confirmation link is invalid';
        case 'already_confirmed':
          return 'This submission is already confirmed';
        case 'rejected':
          return 'This submission was rejected';
        case 'token_expired':
          return 'This confirmation link has expired';
      }
  }
}

function body(state: State): string {
  switch (state.kind) {
    case 'loading':
      return 'One moment while we verify the link from your email.';
    case 'success':
      return 'Thanks — your price is now published and will appear in search results.';
    case 'missing-token':
      return "The link you followed doesn't include a confirmation token. Check the link in your email and try again.";
    case 'network-error':
      return 'Check your connection and reload this page to try again.';
    case 'error':
      switch (state.code) {
        case 'invalid_token':
          return "The token in this link wasn't recognized. If you copy-pasted it, make sure the whole token came across. Otherwise, you can submit a new price.";
        case 'already_confirmed':
          return 'No action needed — your submission has been published and is visible in search results.';
        case 'rejected':
          return 'A moderator has rejected this submission. Please contact us if you believe this is a mistake.';
        case 'token_expired':
          return 'Confirmation links expire 48 hours after you submit. You can submit the same price again to generate a new link.';
      }
  }
}

export function ConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>(
    token ? { kind: 'loading' } : { kind: 'missing-token' },
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await confirmSubmission(token);
        if (cancelled) return;
        if (result.ok) {
          setState({ kind: 'success' });
        } else {
          setState({ kind: 'error', code: result.error });
        }
      } catch {
        if (cancelled) return;
        setState({ kind: 'network-error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="card" aria-live="polite">
      <h1>{heading(state)}</h1>
      <p>{body(state)}</p>
      {state.kind === 'success' ? (
        <p>
          <Link to="/">Submit another price</Link>
        </p>
      ) : null}
      {(state.kind === 'error' && state.code === 'token_expired') ||
      state.kind === 'missing-token' ||
      (state.kind === 'error' && state.code === 'invalid_token') ? (
        <p>
          <Link to="/">Go to the submission form</Link>
        </p>
      ) : null}
    </section>
  );
}
