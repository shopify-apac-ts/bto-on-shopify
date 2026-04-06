use super::schema;
use crate::schema::cart_transform_run::cart_transform_run_input::cart::lines::Merchandise;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::HashMap;

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    let lines = input.cart().lines();

    // Group BTO lines by bundle ID.
    let mut groups: HashMap<String, (Option<usize>, Vec<usize>)> = HashMap::new();

    for (i, line) in lines.iter().enumerate() {
        let bundle_id = match line.bundle_id().and_then(|a| a.value().cloned()) {
            Some(v) => v,
            None => continue,
        };

        let entry = groups.entry(bundle_id).or_insert((None, vec![]));

        let is_base = line
            .role()
            .and_then(|a| a.value().map(|v| v.as_str() == "base"))
            .unwrap_or(false);

        if is_base {
            entry.0 = Some(i);
        } else {
            entry.1.push(i);
        }
    }

    let mut operations = vec![];

    for (_bundle_id, (base_idx_opt, component_indices)) in &groups {
        let base_idx = match base_idx_opt {
            Some(i) => *i,
            None => continue,
        };

        if component_indices.is_empty() {
            continue;
        }

        let base = &lines[base_idx];

        let parent_variant_id = match base.merchandise() {
            Merchandise::ProductVariant(v) => v.id().to_string(),
            _ => continue,
        };

        let product_name = base
            .product_name()
            .and_then(|a| a.value().map(|v| v.as_str()))
            .unwrap_or("G TUNE");

        let title = format!("{} カスタム構成", product_name);

        // Forward _bto_upgrades so CartMain can display the upgrade summary
        // after the merge (merged lines lose all attributes otherwise)
        let mut attributes = vec![];
        if let Some(upgrades_val) = base.upgrades().and_then(|a| a.value()) {
            attributes.push(schema::AttributeOutput {
                key: "_bto_upgrades".to_string(),
                value: upgrades_val.clone(),
            });
        }

        let mut cart_lines = vec![schema::CartLineInput {
            cart_line_id: base.id().to_string(),
            quantity: *base.quantity(),
        }];

        for &ci in component_indices {
            let comp = &lines[ci];
            cart_lines.push(schema::CartLineInput {
                cart_line_id: comp.id().to_string(),
                quantity: *comp.quantity(),
            });
        }

        operations.push(schema::Operation::LinesMerge(schema::LinesMergeOperation {
            cart_lines,
            parent_variant_id,
            title: Some(title),
            price: None,
            image: None,
            attributes: if attributes.is_empty() { None } else { Some(attributes) },
        }));
    }

    Ok(schema::CartTransformRunResult { operations })
}
