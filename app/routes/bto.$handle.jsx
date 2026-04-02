import {useLoaderData} from 'react-router';
import {useState, useMemo} from 'react';
import '../styles/bto.css';

/**
 * BTO コンフィグレーターページ
 * /bto/fzi9g90g8bfdw104dec のようなURLでアクセス
 */

export async function loader({params, context}) {
  const handle = params.handle;

  const {metaobject} = await context.storefront.query(BTO_QUERY, {
    variables: {
      handle: {type: 'bto_product', handle},
    },
  });

  if (!metaobject) {
    throw new Response('BTO Product not found', {status: 404});
  }

  // フィールドをオブジェクトに変換
  const fields = {};
  for (const field of metaobject.fields) {
    fields[field.key] = field.value;
  }

  return {
    handle: metaobject.handle,
    productName: fields.product_name,
    sku: fields.sku,
    basePrice: parseInt(fields.base_price, 10),
    version: fields.version,
    hardwareConfig: JSON.parse(fields.hardware_config),
    peripheralConfig: JSON.parse(fields.peripheral_config),
    serviceConfig: JSON.parse(fields.service_config),
  };
}

export default function BTOConfigurator() {
  const data = useLoaderData();
  const {productName, basePrice, hardwareConfig, peripheralConfig, serviceConfig} = data;

  // 各カテゴリの選択状態を管理
  const allSections = [
    ...hardwareConfig.sections,
    ...peripheralConfig.sections,
    ...serviceConfig.sections,
  ];

  const initialSelections = {};
  for (const section of allSections) {
    if (section.type === 'single_select') {
      const defaultOpt = section.options.find((o) => o.is_default);
      initialSelections[section.slug] = defaultOpt ? section.options.indexOf(defaultOpt) : 0;
    } else if (section.type === 'multi_select') {
      initialSelections[section.slug] = [];
    }
  }

  const [selections, setSelections] = useState(initialSelections);
  const [activeTab, setActiveTab] = useState('hardware');

  // 合計金額計算
  const totalPrice = useMemo(() => {
    let total = basePrice;
    for (const section of allSections) {
      if (section.type === 'single_select') {
        const idx = selections[section.slug];
        if (idx !== undefined && section.options[idx]) {
          total += section.options[idx].price_incl;
        }
      } else if (section.type === 'multi_select') {
        const selected = selections[section.slug] || [];
        for (const idx of selected) {
          if (section.options[idx]) {
            total += section.options[idx].price_incl;
          }
        }
      }
    }
    return total;
  }, [selections, allSections, basePrice]);

  const handleSingleSelect = (slug, optionIndex) => {
    setSelections((prev) => ({...prev, [slug]: optionIndex}));
  };

  const handleMultiSelect = (slug, optionIndex) => {
    setSelections((prev) => {
      const current = prev[slug] || [];
      const next = current.includes(optionIndex)
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex];
      return {...prev, [slug]: next};
    });
  };

  const tabs = [
    {key: 'hardware', label: 'ハードウェア', config: hardwareConfig},
    {key: 'peripheral', label: '周辺機器', config: peripheralConfig},
    {key: 'service', label: 'ソフト・サービス', config: serviceConfig},
  ];

  const activeConfig = tabs.find((t) => t.key === activeTab)?.config;

  return (
    <div className="bto-page">
      <div className="bto-header">
        <h1>{productName}</h1>
        <p className="bto-sku">SKU: {data.sku}</p>
      </div>

      <div className="bto-layout">
        <div className="bto-main">
          {/* タブ */}
          <div className="bto-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`bto-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* カテゴリ一覧（アコーディオン） */}
          <div className="bto-categories">
            {activeConfig?.sections.map((section) => (
              <BTOCategory
                key={section.slug}
                section={section}
                selectedIndex={selections[section.slug]}
                onSingleSelect={(idx) => handleSingleSelect(section.slug, idx)}
                onMultiSelect={(idx) => handleMultiSelect(section.slug, idx)}
              />
            ))}
          </div>
        </div>

        {/* 価格サイドバー（スティッキー） */}
        <div className="bto-sidebar">
          <div className="bto-price-box">
            <div className="bto-price-label">お見積り金額（税込）</div>
            <div className="bto-price-total">
              &yen;{totalPrice.toLocaleString()}
            </div>
            <div className="bto-price-base">
              ベース価格: &yen;{basePrice.toLocaleString()}
            </div>
            {totalPrice !== basePrice && (
              <div className="bto-price-diff">
                カスタマイズ: +&yen;{(totalPrice - basePrice).toLocaleString()}
              </div>
            )}
            <button className="bto-cart-button">カートに追加</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BTOCategory コンポーネント（アコーディオン式）
// ============================================================

function BTOCategory({section, selectedIndex, onSingleSelect, onMultiSelect}) {
  const [isOpen, setIsOpen] = useState(false);

  // 固定スペックの場合
  if (section.type === 'fixed') {
    return (
      <div className="bto-category bto-category-fixed">
        <div className="bto-category-header">
          <span className="bto-category-name">{section.name}</span>
          <span className="bto-category-value">{section.fixed_value}</span>
        </div>
      </div>
    );
  }

  // 現在の選択を表示
  let currentLabel = '';
  let currentPrice = 0;
  if (section.type === 'single_select') {
    const opt = section.options[selectedIndex];
    if (opt) {
      currentLabel = opt.name;
      currentPrice = opt.price_incl;
    }
  } else if (section.type === 'multi_select') {
    const count = (selectedIndex || []).length;
    currentLabel = count > 0 ? `${count}件選択中` : '未選択';
  }

  return (
    <div className={`bto-category ${isOpen ? 'open' : ''}`}>
      <button
        className="bto-category-header bto-category-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="bto-category-name">{section.name}</span>
        <span className="bto-category-current">
          <span className="bto-current-label">{currentLabel}</span>
          {currentPrice > 0 && (
            <span className="bto-current-price">+&yen;{currentPrice.toLocaleString()}</span>
          )}
        </span>
        <span className={`bto-chevron ${isOpen ? 'open' : ''}`}>&#9660;</span>
      </button>

      {isOpen && (
        <div className="bto-options">
          {section.options.map((option, idx) => {
            const isSelected =
              section.type === 'single_select'
                ? selectedIndex === idx
                : (selectedIndex || []).includes(idx);

            return (
              <label
                key={idx}
                className={`bto-option ${isSelected ? 'selected' : ''} ${option.is_default ? 'default' : ''}`}
              >
                <input
                  type={section.type === 'single_select' ? 'radio' : 'checkbox'}
                  name={section.slug}
                  checked={isSelected}
                  onChange={() =>
                    section.type === 'single_select'
                      ? onSingleSelect(idx)
                      : onMultiSelect(idx)
                  }
                />
                <span className="bto-option-content">
                  <span className="bto-option-name">
                    {option.name}
                    {option.is_recommended && (
                      <span className="bto-badge-recommended">オススメ</span>
                    )}
                    {option.is_default && (
                      <span className="bto-badge-default">標準</span>
                    )}
                  </span>
                  <span className="bto-option-price">
                    {option.price_incl === 0
                      ? ''
                      : option.price_incl > 0
                        ? `+\u00a5${option.price_incl.toLocaleString()}`
                        : `-\u00a5${Math.abs(option.price_incl).toLocaleString()}`}
                    {option.price_incl !== 0 && (
                      <span className="bto-option-price-excl">
                        (税別 &yen;{option.price_excl.toLocaleString()})
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Storefront API GraphQL クエリ
// ============================================================

const BTO_QUERY = `#graphql
  query BTOProduct($handle: MetaobjectHandleInput!) {
    metaobject(handle: $handle) {
      handle
      type
      fields {
        key
        value
      }
    }
  }
`;