'use server';

import { signIn } from '@/lib/auth/config';

export type SignInState =
  | { status: 'idle' }
  | { status: 'sent'; email: string }
  | { status: 'error'; message: string };

export async function requestMagicLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = formData.get('email');
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return { status: 'error', message: 'Please enter a valid email.' };
  }
  try {
    await signIn('resend', { email, redirect: false });
    return { status: 'sent', email };
  } catch (err) {
    // Don't surface provider/Auth.js internals to the client; log server-side only.
    console.error('requestMagicLink failed', err);
    return {
      status: 'error',
      message: 'Could not send the magic link. Please try again.',
    };
  }
}
