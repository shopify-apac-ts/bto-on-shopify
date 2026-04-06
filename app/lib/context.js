import {createHydrogenContext} from '@shopify/hydrogen';
import {AppSession} from '~/lib/session';
import {CART_QUERY_FRAGMENT} from '~/lib/fragments';

// Define the additional context object
const additionalContext = {
  // Additional context for custom properties, CMS clients, 3P SDKs, etc.
  // These will be available as both context.propertyName and context.get(propertyContext)
  // Example of complex objects that could be added:
  // cms: await createCMSClient(env),
  // reviews: await createReviewsClient(env),
};

/**
 * Creates Hydrogen context for React Router 7.9.x
 * Returns HydrogenRouterContextProvider with hybrid access patterns
 * @param {Request} request
 * @param {Env} env
 * @param {ExecutionContext} executionContext
 */
export async function createHydrogenRouterContext(
  request,
  env,
  executionContext,
) {
  /**
   * Open a cache instance in the worker and a custom session instance.
   */
  if (!env?.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }

  const waitUntil = executionContext.waitUntil.bind(executionContext);
  const [cache, session] = await Promise.all([
    caches.open('hydrogen'),
    AppSession.init(request, [env.SESSION_SECRET]),
  ]);

  const hydrogenContext = createHydrogenContext(
    {
      env,
      request,
      cache,
      waitUntil,
      session,
      // Detect language from cookie; default to Japanese (store primary language)
      i18n: {
        language: getLanguageFromRequest(request),
        country: 'JP',
      },
      cart: {
        queryFragment: CART_QUERY_FRAGMENT,
      },
    },
    additionalContext,
  );

  return hydrogenContext;
}

/**
 * Reads `bto_lang` cookie from request and returns a valid Storefront API LanguageCode.
 * Supported: 'JA' | 'EN'. Defaults to 'JA'.
 * @param {Request} request
 * @returns {'JA' | 'EN'}
 */
function getLanguageFromRequest(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/bto_lang=([^;]+)/);
  const lang = match?.[1]?.toUpperCase();
  return lang === 'EN' ? 'EN' : 'JA';
}

/** @typedef {Class<additionalContext>} AdditionalContextType */
