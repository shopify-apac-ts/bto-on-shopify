import {useLoaderData, Link} from 'react-router';
import {Image, Money} from '@shopify/hydrogen';
import {useState} from 'react';

export const meta = () => [{title: 'G TUNE | Gaming PC'}];

export async function loader({context}) {
  const data = await context.storefront.query(GTUNE_PRODUCTS_QUERY);
  // Build a handle→product map from aliased fields
  const products = Object.values(data).filter(Boolean);
  return {products};
}

const CATEGORIES = [
  {key: 'all', label: 'すべて'},
  {key: 'desktop', label: 'デスクトップPC'},
  {key: 'note', label: 'ノートPC'},
];

// Static product catalogue — only FZ-I9G90 is a live BTO link
const GTUNE_LINEUP = [
  {
    handle: 'g-tune-fz-i9g90',
    name: 'G TUNE FZ-I9G90',
    category: 'desktop',
    tag: 'ハイエンド',
    description:
      'Core Ultra 9 285K × RTX 5090搭載。\nプロも認めるハイエンドゲーミングデスクトップ。',
    btoHandle: 'fzi9g90g8bfdw104dec',
    active: true,
  },
  {
    handle: null,
    name: 'G TUNE FZ-I7G6T',
    category: 'desktop',
    tag: 'ミドルレンジ',
    description: 'Core i7 × RTX 5060 Ti搭載。\nオールラウンドなミドルクラス。',
    active: false,
  },
  {
    handle: null,
    name: 'G TUNE DG-I5G60',
    category: 'desktop',
    tag: 'エントリー',
    description: 'Core i5 × RTX 5060搭載。\n初めてのゲーミングPCにおすすめ。',
    active: false,
  },
  {
    handle: null,
    name: 'G TUNE P5',
    category: 'note',
    tag: '15.6型',
    description: 'Core Ultra 7 × RTX 5060搭載。\n吸気性能アップのエアインテークリフター。',
    active: false,
  },
  {
    handle: null,
    name: 'G TUNE E5',
    category: 'note',
    tag: '15.6型',
    description: 'Core i7搭載の薄型軽量ノート。\n持ち運べるゲーミングPC。',
    active: false,
  },
];

export default function GTunePage() {
  const {products} = useLoaderData();
  const [activeCategory, setActiveCategory] = useState('all');

  // Build a map of handle → Shopify product data
  const productMap = {};
  for (const p of products) {
    productMap[p.handle] = p;
  }

  const filtered =
    activeCategory === 'all'
      ? GTUNE_LINEUP
      : GTUNE_LINEUP.filter((p) => p.category === activeCategory);

  return (
    <div className="gtune-page">
      {/* Hero */}
      <div className="gtune-hero">
        <div className="gtune-hero-content">
          <div className="gtune-logo">G<span>TUNE</span></div>
          <p className="gtune-hero-tagline">
            プロeスポーツチームも信頼するゲーミングPCブランド
          </p>
        </div>
      </div>

      {/* Category tabs */}
      <div className="gtune-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={'gtune-tab' + (activeCategory === cat.key ? ' active' : '')}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="gtune-grid">
        {filtered.map((item) => {
          const shopifyProduct = item.handle ? productMap[item.handle] : null;
          const image = shopifyProduct?.featuredImage;
          const price = shopifyProduct?.priceRange?.minVariantPrice;

          const card = (
            <div className={'gtune-card' + (item.active ? ' gtune-card--active' : '')}>
              {item.tag && <span className="gtune-card-tag">{item.tag}</span>}
              {item.active && (
                <span className="gtune-card-badge">BTO カスタマイズ可</span>
              )}
              <div className="gtune-card-image">
                {image ? (
                  <Image data={image} sizes="400px" alt={item.name} />
                ) : (
                  <div className="gtune-card-image-placeholder" />
                )}
              </div>
              <div className="gtune-card-body">
                <h3 className="gtune-card-name">{item.name}</h3>
                <p className="gtune-card-desc">{item.description}</p>
                {price && (
                  <p className="gtune-card-price">
                    税込 <Money data={price} />〜
                  </p>
                )}
                {item.active ? (
                  <span className="gtune-card-cta">カスタマイズして購入 →</span>
                ) : (
                  <span className="gtune-card-cta gtune-card-cta--disabled">近日公開</span>
                )}
              </div>
            </div>
          );

          return item.active ? (
            <Link
              key={item.name}
              to={`/bto/${item.btoHandle}`}
              className="gtune-card-link"
              prefetch="intent"
            >
              {card}
            </Link>
          ) : (
            <div key={item.name} className="gtune-card-link gtune-card-link--inactive">
              {card}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GTUNE_PRODUCTS_QUERY = `#graphql
  query GtuneProducts($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    fzi9g90: product(handle: "g-tune-fz-i9g90") {
      id
      handle
      title
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      featuredImage {
        id
        url
        altText
        width
        height
      }
    }
  }
`;

/** @typedef {import('./+types/_index').Route} Route */
