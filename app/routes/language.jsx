/**
 * Language switcher action route.
 * POST /language  { lang: 'JA' | 'EN' }
 * Sets the bto_lang cookie and redirects back to the referring page.
 */
import {redirect} from 'react-router';

export async function action({request}) {
  const formData = await request.formData();
  const lang = formData.get('lang')?.toString().toUpperCase();
  const validLang = lang === 'EN' ? 'EN' : 'JA';
  const redirectTo = request.headers.get('referer') || '/';

  return redirect(redirectTo, {
    headers: {
      'Set-Cookie': `bto_lang=${validLang}; Path=/; Max-Age=31536000; SameSite=Lax`,
    },
  });
}
