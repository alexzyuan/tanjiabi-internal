function readMonth(args, index, flag) {
  const month = String(args[index + 1] || "").trim();
  if (!month) throw new Error(`库存分类账参数 ${flag} 缺少月份。`);
  if (!/^\d{4}-\d{2}$/u.test(month)) throw new Error(`库存分类账参数 ${flag} 月份格式必须为 YYYY-MM。`);
  return month;
}

function readSellerId(args, index) {
  const sellerId = String(args[index + 1] || "").trim();
  if (!sellerId) throw new Error("库存分类账参数 --seller-id 缺少 seller_id。");
  return sellerId;
}

export function parseInventoryLedgerRebuildCliOptions(args = []) {
  const options = { force: false, dryRun: false, startMonth: undefined, ledgerSeedMonth: undefined, sellerIds: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--start-month") {
      options.startMonth = readMonth(args, index, arg);
      index += 1;
    } else if (arg === "--ledger-seed-month") {
      options.ledgerSeedMonth = readMonth(args, index, arg);
      index += 1;
    } else if (arg === "--seller-id") {
      options.sellerIds.push(readSellerId(args, index));
      index += 1;
    } else {
      throw new Error(`库存分类账不支持的参数：${arg}`);
    }
  }
  options.sellerIds = [...new Set(options.sellerIds)];
  if (options.sellerIds.length && !options.dryRun) {
    throw new Error("库存分类账参数 --seller-id 仅允许用于 --dry-run 验证。");
  }
  return options;
}
