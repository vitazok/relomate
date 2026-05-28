import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { env } from '@/lib/env';
import { verificationAdapter } from './adapter';

const isDev = env.NODE_ENV !== 'production';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: verificationAdapter,
  session: { strategy: 'jwt' },
  secret: env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Resend({
      apiKey: env.AUTH_RESEND_KEY ?? 'dev-no-key',
      from: env.EMAIL_FROM ?? 'noreply@example.com',
      ...(isDev && {
        async sendVerificationRequest({ identifier, url }) {
          console.log(
            `\n  ✉  Magic link for ${identifier}\n     ${url}\n`,
          );
        },
      }),
    }),
  ],
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn() {
      return true;
    },
    async redirect({ url, baseUrl }) {
      try {
        const target = new URL(url, baseUrl);
        if (target.origin !== baseUrl) return baseUrl;
        if (target.pathname === '/api/claim-anonymous') {
          return target.toString();
        }
        return `${baseUrl}/api/claim-anonymous`;
      } catch {
        return `${baseUrl}/api/claim-anonymous`;
      }
    },
  },
});
