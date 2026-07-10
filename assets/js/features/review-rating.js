const REVIEW_PERCENT_TONE_CLASSES = ["is-muted", "is-warning", "is-danger", "is-success"];

export function createReviewRatingFeature({
  root = globalThis.document,
  bind,
  bindAll,
  fieldValue,
  formatNumber,
  parseNumber,
  setExclusiveClassState,
  setText,
} = {}) {
  function parseReviewPercent(value) {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) return null;
    const number = Number(rawValue.replace(/,/g, "").replace(/%/g, ""));
    if (!Number.isFinite(number) || number < 0) return 0;
    return number > 1 ? number / 100 : number;
  }

  function formatReviewDecimal(value, digits = 2) {
    if (!Number.isFinite(value)) return "-";
    return Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatReviewFlexible(value) {
    if (!Number.isFinite(value)) return "-";
    return Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function setReviewPercentStatus(text, tone = "muted") {
    const status = root?.querySelector?.("#review-rating-status");
    if (!status) return;
    status.textContent = text;
    setExclusiveClassState(status, REVIEW_PERCENT_TONE_CLASSES, `is-${tone}`);
  }

  function reviewPercentStatus(percentTotal, hasPercentInput) {
    if (!hasPercentInput) return { valid: false, text: "请填写星级占比", tone: "muted" };
    const percent = percentTotal * 100;
    const diff = percent - 100;
    if (Math.abs(diff) < 0.0001) return { valid: true, text: "占比合计 100%，可以计算", tone: "success" };
    if (diff < 0) return { valid: false, text: `占比合计 ${formatReviewFlexible(percent)}%，还差 ${formatReviewFlexible(Math.abs(diff))}%`, tone: "warning" };
    return { valid: false, text: `占比合计 ${formatReviewFlexible(percent)}%，超出 ${formatReviewFlexible(diff)}%`, tone: "danger" };
  }

  function calculateReviewRating() {
    const totalInput = root?.querySelector?.("#review-total");
    if (!totalInput) return;
    const reviewTotalRaw = String(totalInput.value ?? "").trim();
    const targetInput = root?.querySelector?.("#review-target");
    const targetRaw = String(targetInput?.value ?? "").trim();
    const reviewTotal = reviewTotalRaw ? Math.max(0, parseNumber(reviewTotalRaw)) : null;
    const targetScore = targetRaw ? Math.max(0, parseNumber(targetRaw)) : 4;
    let weightedPoints = 0;
    let countedReviews = 0;
    let percentTotal = 0;
    let hasPercentInput = false;

    [5, 4, 3, 2, 1].forEach((star) => {
      const rate = parseReviewPercent(fieldValue(`[data-review-percent="${star}"]`, "", root));
      if (rate === null || reviewTotal === null) {
        setText(`#review-count-${star}`, "--", root);
        setText(`#review-points-${star}`, "--", root);
        return;
      }
      const count = reviewTotal * rate;
      const points = count * star;
      hasPercentInput = true;
      percentTotal += rate;
      countedReviews += count;
      weightedPoints += points;
      setText(`#review-count-${star}`, formatReviewFlexible(count), root);
      setText(`#review-points-${star}`, formatReviewFlexible(points), root);
    });

    const percentStatus = reviewPercentStatus(percentTotal, hasPercentInput);
    const hasEnoughInput = reviewTotal !== null && percentStatus.valid && countedReviews > 0;
    const currentScore = hasEnoughInput ? weightedPoints / countedReviews : null;
    let exactNeeded = 0;
    let roundedNeeded = null;
    let status = reviewTotal === null ? "请填写 review 总数" : percentStatus.text;
    let statusTone = reviewTotal === null ? "muted" : percentStatus.tone;
    if (hasEnoughInput) {
      roundedNeeded = 0;
      status = "目标已达成";
      statusTone = "success";
    }
    if (hasEnoughInput && targetScore > currentScore) {
      if (targetScore >= 5) {
        status = "目标分数需低于5";
        statusTone = "danger";
        roundedNeeded = null;
      } else {
        exactNeeded = Math.max(0, (targetScore * countedReviews - weightedPoints) / (5 - targetScore));
        roundedNeeded = Math.ceil(exactNeeded);
        status = `还需补 ${roundedNeeded} 个 5 星 review`;
        statusTone = "success";
      }
    }

    const afterTotal = roundedNeeded === null ? null : countedReviews + roundedNeeded;
    const afterScore = afterTotal ? (weightedPoints + roundedNeeded * 5) / afterTotal : null;

    setText("#review-current-score", hasEnoughInput ? formatReviewDecimal(currentScore) : "--", root);
    setText("#review-current-note", hasEnoughInput ? `${formatReviewFlexible(countedReviews)} 个 review` : "等待输入", root);
    setText("#review-target-score", formatReviewDecimal(targetScore), root);
    setText("#review-target-note", targetScore > 5 ? "目标超出范围" : "目标分", root);
    setText("#review-needed-rounded", roundedNeeded === null ? "--" : formatNumber(roundedNeeded), root);
    setText("#review-needed-unit", roundedNeeded === null ? "" : "个", root);
    setText("#review-needed-summary", roundedNeeded === null ? "--" : `${formatNumber(roundedNeeded)} 个`, root);
    setText("#review-needed-exact", roundedNeeded === null ? "等待计算" : (exactNeeded ? `精确值 ${formatReviewFlexible(exactNeeded)}` : "不需要"), root);
    setText("#review-after-score", afterScore === null ? "--" : formatReviewDecimal(afterScore), root);
    setText("#review-after-note", afterTotal === null ? "等待计算" : `补后总数 ${formatReviewFlexible(afterTotal)}`, root);
    setText("#review-percent-total", hasPercentInput ? `${formatReviewFlexible(percentTotal * 100)}%` : "--", root);
    setText("#review-weighted-points", hasEnoughInput ? formatReviewFlexible(weightedPoints) : "--", root);
    setText("#review-count-total", hasEnoughInput ? formatReviewFlexible(countedReviews) : "--", root);
    setText("#review-after-total", afterTotal === null ? "--" : formatReviewFlexible(afterTotal), root);
    setReviewPercentStatus(status, statusTone);
    setText("#review-formula-note", roundedNeeded === null
      ? (reviewTotal !== null && hasPercentInput && !percentStatus.valid ? "星级占比合计必须等于 100%，才会计算预计需要补几个 5 星。" : "填写 review 总数和各星级占比后，会自动计算预计需要补几个 5 星。")
      : roundedNeeded
      ? `按当前分布补入 ${roundedNeeded} 个 5 星后，评分约为 ${formatReviewDecimal(afterScore)}。`
      : status, root);
  }

  function resetReviewRatingCalculator() {
    const total = root?.querySelector?.("#review-total");
    const target = root?.querySelector?.("#review-target");
    if (total) total.value = "";
    if (target) target.value = "4";
    [5, 4, 3, 2, 1].forEach((star) => {
      const input = root?.querySelector?.(`[data-review-percent="${star}"]`);
      if (input) input.value = "";
    });
    calculateReviewRating();
  }

  function setupReviewRatingCalculator() {
    bind(root, "#review-rating-reset-button", "click", resetReviewRatingCalculator);
    bindAll(root, "#review-total, #review-target, .review-percent-input", "input", calculateReviewRating);
    bindAll(root, "#review-total, #review-target, .review-percent-input", "change", calculateReviewRating);
    calculateReviewRating();
  }

  return {
    calculateReviewRating,
    resetReviewRatingCalculator,
    setupReviewRatingCalculator,
  };
}
