import {useOptimisticCart, CartForm, Image} from '@shopify/hydrogen';
import {Link, useLocation} from 'react-router';
import {useState, useEffect} from 'react';
import {useAside} from '~/components/Aside';
import {CartLineItem} from '~/components/CartLineItem';
import {CartSummary} from './CartSummary';
/**
 * Returns a map of all line items and their children.
 * @param {CartLine[]} lines
 * @return {import("/home/runner/work/hydrogen/hydrogen/templates/skeleton-js/app/components/CartMain").LineItemChildrenMap}
 */
function getLineItemChildrenMap(lines) {
  const children = {};
  for (const line of lines) {
    if ('parentRelationship' in line && line.parentRelationship?.parent) {
      const parentId = line.parentRelationship.parent.id;
      if (!children[parentId]) children[parentId] = [];
      children[parentId].push(line);
    }
    if ('lineComponents' in line) {
      const children = getLineItemChildrenMap(line.lineComponents);
      for (const [parentId, childIds] of Object.entries(children)) {
        if (!children[parentId]) children[parentId] = [];
        children[parentId].push(...childIds);
      }
    }
  }
  return children;
}
/**
 * The main cart component that displays the cart items and summary.
 * It is used by both the /cart route and the cart aside dialog.
 * @param {CartMainProps}
 */
export function CartMain({layout, cart: originalCart}) {
  // The useOptimisticCart hook applies pending actions to the cart
  // so the user immediately sees feedback when they modify the cart.
  const cart = useOptimisticCart(originalCart);

  const linesCount = Boolean(cart?.lines?.nodes?.length || 0);
  const withDiscount =
    cart &&
    Boolean(cart?.discountCodes?.filter((code) => code.applicable)?.length);
  const className = `cart-main ${withDiscount ? 'with-discount' : ''}`;
  const cartHasItems = cart?.totalQuantity ? cart.totalQuantity > 0 : false;
  const childrenMap = getLineItemChildrenMap(cart?.lines?.nodes ?? []);

  // After Cart Transform Function merges lines, the merged line has _bto_upgrades
  // (forwarded from base line) but no _bto_bundle_id. Pre-merge, group by bundle ID.
  const allLines = cart?.lines?.nodes ?? [];
  const mergedBtoLines = [];  // post-Function: single merged line per bundle
  const bundleMap = {};       // pre-Function: raw lines grouped by bundle ID
  const nonBtoLines = [];

  for (const line of allLines) {
    if ('parentRelationship' in line && line.parentRelationship?.parent) continue;
    const bundleId = line.attributes?.find((a) => a.key === '_bto_bundle_id')?.value;
    const hasBtoProduct = line.attributes?.find((a) => a.key === '_bto_product');
    const hasUpgrades = line.attributes?.find((a) => a.key === '_bto_upgrades');

    if (!bundleId && (hasBtoProduct || hasUpgrades)) {
      // Merged line from Cart Transform Function
      mergedBtoLines.push(line);
    } else if (bundleId) {
      // Raw pre-merge lines
      if (!bundleMap[bundleId]) bundleMap[bundleId] = {base: null, components: []};
      const role = line.attributes?.find((a) => a.key === '_bto_role')?.value;
      if (role === 'base') bundleMap[bundleId].base = line;
      else bundleMap[bundleId].components.push(line);
    } else {
      nonBtoLines.push(line);
    }
  }

  return (
    <div className={className}>
      <CartEmpty hidden={linesCount} layout={layout} />
      <div className="cart-details">
        <p id="cart-lines" className="sr-only">
          Line items
        </p>
        {cartHasItems && (
          <CartForm
            route="/cart"
            action={CartForm.ACTIONS.LinesRemove}
            inputs={{lineIds: cart.lines.nodes.map((l) => l.id)}}
          >
            <button type="submit" className="cart-remove-all">
              すべて削除
            </button>
          </CartForm>
        )}
        <div>
          <ul aria-labelledby="cart-lines">
            {mergedBtoLines.map((line) => (
              <MergedBTOLineItem key={line.id} line={line} />
            ))}
            {Object.entries(bundleMap).map(([bundleId, {base, components}]) =>
              base ? (
                <BTOBundleItem key={bundleId} base={base} components={components} layout={layout} />
              ) : null,
            )}
            {nonBtoLines.map((line) => (
              <CartLineItem key={line.id} line={line} layout={layout} childrenMap={childrenMap} />
            ))}
          </ul>
        </div>
        {cartHasItems && (
          <>
            {cart?.attributes?.filter((a) => !a.key.startsWith('_')).length >
              0 && (
              <div className="cart-attributes">
                <h3>Cart notes</h3>
                <dl>
                  {cart.attributes
                    .filter((a) => !a.key.startsWith('_'))
                    .map((attr) => (
                      <div key={attr.key} className="cart-attribute">
                        <dt>{attr.key}</dt>
                        <dd>{attr.value}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
            <CartSummary cart={cart} layout={layout} />
          </>
        )}
      </div>
    </div>
  );
}

// Renders a BTO line after the Cart Transform Function has merged it
function MergedBTOLineItem({line}) {
  const {close} = useAside();
  const {product, image} = line.merchandise;
  const productName = line.attributes?.find((a) => a.key === '_bto_product')?.value || product.title;
  const upgrades = line.attributes?.find((a) => a.key === '_bto_upgrades')?.value;
  // _bto_handle may be absent if the Cart Transform Function did not forward it;
  // fall back to whatever the user last visited via localStorage.
  const attrHandle = line.attributes?.find((a) => a.key === '_bto_handle')?.value;
  const [storedBtoPath, setStoredBtoPath] = useState(null);
  useEffect(() => {
    if (!attrHandle) {
      const saved = localStorage.getItem('lastBtoPath');
      if (saved) setStoredBtoPath(saved);
    }
  }, [attrHandle]);
  const editPath = attrHandle ? `/bto/${attrHandle}` : storedBtoPath;
  const price = line.cost?.totalAmount?.amount;

  return (
    <li className="cart-line cart-bto-bundle">
      <div className="cart-line-inner">
        {image && (
          <Image alt={productName} aspectRatio="1/1" data={image} height={100} loading="lazy" width={100} />
        )}
        <div style={{flex: 1}}>
          <p><strong>{productName} カスタム構成</strong></p>
          <p className="cart-bto-price">
            {price ? `¥${Number(price).toLocaleString('ja-JP')}` : '—'}
          </p>
          {upgrades && <p className="cart-bto-upgrades">{upgrades}</p>}
          <div className="cart-bto-actions">
            {editPath && (
              <Link to={editPath} className="cart-bto-edit" onClick={close}>編集</Link>
            )}
            <CartForm route="/cart" action={CartForm.ACTIONS.LinesRemove} inputs={{lineIds: [line.id]}}>
              {(fetcher) => (
                <button type="submit" className="cart-bto-remove" disabled={fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? (
                    <span className="cart-loading-spinner" aria-label="削除中" />
                  ) : '削除'}
                </button>
              )}
            </CartForm>
          </div>
        </div>
      </div>
    </li>
  );
}

function BTOBundleItem({base, components, layout}) {
  const {close} = useAside();
  const [showComponents, setShowComponents] = useState(false);
  const {product, image} = base.merchandise;
  const productName = base.attributes?.find((a) => a.key === '_bto_product')?.value || product.title;
  const upgrades = base.attributes?.find((a) => a.key === '_bto_upgrades')?.value;
  const handle = base.attributes?.find((a) => a.key === '_bto_handle')?.value;
  const count = components.length;
  const allLineIds = [base.id, ...components.map((c) => c.id)];

  return (
    <li className="cart-line cart-bto-bundle">
      <div className="cart-line-inner">
        {image && (
          <Image alt={productName} aspectRatio="1/1" data={image} height={100} loading="lazy" width={100} />
        )}
        <div style={{flex: 1}}>
          <p><strong>{productName} カスタム構成</strong></p>
          <p className="cart-bto-price">¥{base.cost?.totalAmount?.amount ? Number(base.cost.totalAmount.amount).toLocaleString('ja-JP') : '—'}</p>
          {upgrades && <p className="cart-bto-upgrades">{upgrades}</p>}
          <button
            className="cart-bto-toggle"
            onClick={() => setShowComponents((v) => !v)}
          >
            {showComponents ? `構成を隠す ↑` : `構成を表示 (${count}件) ↓`}
          </button>
          {showComponents && (
            <ul className="cart-bto-components">
              {components.map((c) => (
                <li key={c.id} className="cart-bto-component">
                  <span>{c.merchandise?.product?.title}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="cart-bto-actions">
            {handle && (
              <Link to={`/bto/${handle}`} className="cart-bto-edit" onClick={close}>編集</Link>
            )}
            <CartForm
              route="/cart"
              action={CartForm.ACTIONS.LinesRemove}
              inputs={{lineIds: allLineIds}}
            >
              {(fetcher) => (
                <button type="submit" className="cart-bto-remove" disabled={fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? (
                    <span className="cart-loading-spinner" aria-label="削除中" />
                  ) : '削除'}
                </button>
              )}
            </CartForm>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * @param {{
 *   hidden: boolean;
 *   layout?: CartMainProps['layout'];
 * }}
 */
function CartEmpty({hidden = false}) {
  const {close} = useAside();
  const location = useLocation();
  const [storedBtoPath, setStoredBtoPath] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('lastBtoPath');
    if (saved) setStoredBtoPath(saved);
  }, []);

  // If the cart aside is open while the user is on a BTO page, use that path directly.
  // Otherwise fall back to whatever was last stored in localStorage.
  const isBtoPage = location.pathname.startsWith('/bto/');
  const continuePath = isBtoPage ? location.pathname : storedBtoPath;

  return (
    <div hidden={hidden}>
      <br />
      <p>カートにはまだ商品がありません。</p>
      <br />
      {continuePath && (
        <Link to={continuePath} onClick={close} prefetch="viewport">
          ショッピングを続ける →
        </Link>
      )}
    </div>
  );
}

/** @typedef {'page' | 'aside'} CartLayout */
/**
 * @typedef {{
 *   cart: CartApiQueryFragment | null;
 *   layout: CartLayout;
 * }} CartMainProps
 */
/** @typedef {{[parentId: string]: CartLine[]}} LineItemChildrenMap */

/** @typedef {import('@shopify/hydrogen').OptimisticCartLine} OptimisticCartLine */
/** @typedef {import('storefrontapi.generated').CartApiQueryFragment} CartApiQueryFragment */
/** @typedef {import('~/components/CartLineItem').CartLine} CartLine */
