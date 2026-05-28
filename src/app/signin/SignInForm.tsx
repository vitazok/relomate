'use client';

import { useFormState } from 'react-dom';
import { requestMagicLink, type SignInState } from './actions';

const initial: SignInState = { status: 'idle' };

export function SignInForm() {
  const [state, action] = useFormState(requestMagicLink, initial);

  if (state.status === 'sent') {
    return (
      <p className="text-sm">
        Check <strong>{state.email}</strong> for the sign-in link.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="email" className="text-sm">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="border rounded px-2 py-1"
      />
      {state.status === 'error' && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
      <button type="submit" className="border rounded px-3 py-1 mt-2">
        Send magic link
      </button>
    </form>
  );
}
