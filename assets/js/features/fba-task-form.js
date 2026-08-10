export function createFbaTaskFormFeature({
  root = globalThis.document,
  alertImpl = globalThis.alert,
  bind,
  bindBackdropClose,
  checkedField,
  confirmImpl = globalThis.confirm,
  fetchImpl = globalThis.fetch,
  fieldValue,
  findSelectedFbaMskuOption,
  fbaValue,
  getSelectedFbaShops,
  hasCompleteFbaBoxSpec,
  loadFbaAutomationState,
  readFbaBoxSpecFromForm,
  renderFbaAutomationState,
  renderFbaResult,
  renderFbaShopOptions,
  renderFbaWarehouseOptions,
  scheduleFbaMskuLoad,
  selectFbaShopSids,
  setButtonBusy,
  setFbaBoxSpecFields,
  setModalOpenState,
  setText,
  syncFbaQuantityFields,
  timer = globalThis,
  updateFbaShopButton,
} = {}) {
  if (typeof bind !== "function") throw new Error("createFbaTaskFormFeature requires bind.");
  if (typeof fetchImpl !== "function") throw new Error("createFbaTaskFormFeature requires fetch.");

  let editingFbaTaskId = "";

  function query(selector) {
    return root?.querySelector?.(selector) || null;
  }

  function setFbaInputValue(selector, value) {
    const input = query(selector);
    if (input) input.value = value ?? "";
  }

  function readHour(selector, fallback) {
    const value = fbaValue(selector);
    const hour = Number(String(value || "").split(":")[0]);
    return Number.isFinite(hour) ? hour : fallback;
  }

  function readEndHour(selector, fallback) {
    const value = fbaValue(selector);
    if (!value) return fallback;
    const [hourText, minuteText] = String(value).split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText || 0);
    if (!Number.isFinite(hour)) return fallback;
    if (hour === 23 && minute >= 59) return 24;
    return hour;
  }

  function hourToTime(hour, isEnd = false) {
    const value = Number(hour);
    if (isEnd && value >= 24) return "23:59";
    return `${String(Number.isFinite(value) ? value : 0).padStart(2, "0")}:00`;
  }

  function fbaDateText(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addFbaDays(dateText, days) {
    const base = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
    base.setDate(base.getDate() + Number(days || 0));
    return fbaDateText(base);
  }

  function defaultFbaShipDate() {
    return addFbaDays("", 10);
  }

  function defaultFbaDeliveryDate(shipDate = defaultFbaShipDate()) {
    return addFbaDays(shipDate, 10);
  }

  function syncFbaDeliveryDate({ force = false } = {}) {
    const shipInput = query("#fba-ship-date");
    const deliveryInput = query("#fba-delivery-date");
    if (!shipInput || !deliveryInput) return;
    if (!shipInput.value) shipInput.value = defaultFbaShipDate();
    const expected = defaultFbaDeliveryDate(shipInput.value);
    if (force || !deliveryInput.value || deliveryInput.value < shipInput.value) {
      deliveryInput.value = expected;
    }
  }

  function setFbaNotificationPolicy(value) {
    const normalized = ["all", "none"].includes(value) ? value : "matched";
    root.querySelectorAll("input[name='fba-notification-policy']").forEach((input) => {
      input.checked = input.value === normalized;
    });
  }

  function normalizeFbaShippingModeForForm(mode, keyword = "海运") {
    const normalizedMode = String(mode || "").trim().toUpperCase();
    if (normalizedMode === "GROUND_SMALL_PARCEL") return "GROUND_SMALL_PARCEL";
    return "FREIGHT_LTL";
  }

  function resetFbaTaskForm() {
    setFbaInputValue("#fba-target-warehouse", "");
    setFbaInputValue("#fba-plan-name", "");
    setFbaInputValue("#fba-msku", "");
    setFbaInputValue("#fba-box-count", "1");
    setFbaInputValue("#fba-pack-quantity", "");
    setFbaInputValue("#fba-quantity", "");
    setFbaBoxSpecFields({}, "");
    setFbaInputValue("#fba-position-type", "1");
    setFbaInputValue("#fba-ship-date", defaultFbaShipDate());
    setFbaInputValue("#fba-delivery-date", defaultFbaDeliveryDate());
    setFbaInputValue("#fba-shipping-mode", "FREIGHT_LTL");
    setFbaInputValue("#fba-shipping-solution", "USE_YOUR_OWN_CARRIER");
    setFbaInputValue("#fba-transportation-keyword", "海运");
    setFbaInputValue("#fba-task-interval", "20");
    setFbaInputValue("#fba-active-start-date", "");
    setFbaInputValue("#fba-active-end-date", "");
    setFbaInputValue("#fba-start-time", "00:00");
    setFbaInputValue("#fba-end-time", "23:59");
    const schedule = query("#fba-schedule-enabled");
    if (schedule) schedule.checked = true;
    setFbaNotificationPolicy("matched");
  }

  function fillFbaTaskForm(task) {
    if (!task) return;
    selectFbaShopSids([Number(task.shop?.sid)].filter(Boolean));
    setFbaInputValue("#fba-target-warehouse", task.targetWarehouseCode || "");
    setFbaInputValue("#fba-plan-name", task.planName || "");
    setFbaInputValue("#fba-msku", task.msku || "");
    setFbaInputValue("#fba-box-count", task.boxCount || 1);
    setFbaInputValue("#fba-pack-quantity", task.packQuantity || "");
    setFbaInputValue("#fba-quantity", task.quantity || "");
    setFbaBoxSpecFields({ boxDimensions: task.boxDimensions, boxWeight: task.boxWeight }, task.boxSource || "template");
    setFbaInputValue("#fba-position-type", task.positionType || "1");
    const shipDate = task.deliveryPreferences?.shipDate || defaultFbaShipDate();
    setFbaInputValue("#fba-ship-date", shipDate);
    setFbaInputValue("#fba-delivery-date", task.deliveryPreferences?.deliveryDate || defaultFbaDeliveryDate(shipDate));
    setFbaInputValue("#fba-shipping-mode", normalizeFbaShippingModeForForm(task.deliveryPreferences?.shippingMode, task.deliveryPreferences?.transportationKeyword));
    setFbaInputValue("#fba-shipping-solution", task.deliveryPreferences?.shippingSolution || "USE_YOUR_OWN_CARRIER");
    setFbaInputValue("#fba-transportation-keyword", task.deliveryPreferences?.transportationKeyword || "海运");
    setFbaInputValue("#fba-task-interval", task.runIntervalMinutes || 20);
    setFbaInputValue("#fba-active-start-date", task.activeStartDate || "");
    setFbaInputValue("#fba-active-end-date", task.activeEndDate || "");
    setFbaInputValue("#fba-start-time", hourToTime(task.startHour ?? 0));
    setFbaInputValue("#fba-end-time", hourToTime(task.endHour ?? 24, true));
    const schedule = query("#fba-schedule-enabled");
    if (schedule) schedule.checked = task.scheduleEnabled === true;
    setFbaNotificationPolicy(task.notificationPolicy || "matched");
  }

  function openFbaTaskModal(task = null) {
    if (task?.target) task = null;
    const modal = query("#fba-task-modal");
    if (!modal) return;
    editingFbaTaskId = task?.id || "";
    resetFbaTaskForm();
    if (task) fillFbaTaskForm(task);
    setText("#fba-task-modal-title", task ? "编辑刷仓任务" : "新建刷仓任务", root);
    const saveButton = query("#fba-add-task-button");
    if (saveButton) saveButton.textContent = task ? "保存修改" : "确认新建";
    setModalOpenState(modal, true);
    renderFbaShopOptions();
    renderFbaWarehouseOptions();
    updateFbaShopButton();
    syncFbaQuantityFields();
    syncFbaDeliveryDate();
    scheduleFbaMskuLoad(50);
  }

  function closeFbaTaskModal() {
    const modal = query("#fba-task-modal");
    if (!modal) return;
    setModalOpenState(modal, false);
    editingFbaTaskId = "";
  }

  async function saveFbaBoxTemplateIfNeeded(payload) {
    if (payload.positionType !== "1") return;
    if (payload.boxSource === "erp") return;
    if (!hasCompleteFbaBoxSpec({ boxDimensions: payload.boxDimensions, boxWeight: payload.boxWeight })) return;
    const response = await fetchImpl("/api/fba/box-template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sid: payload.sid,
        msku: payload.inboundPlanItems?.[0]?.msku,
        boxDimensions: payload.boxDimensions,
        boxWeight: payload.boxWeight,
        source: "manual",
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `保存箱规模板失败：API ${response.status}`);
  }

  function validateFbaPayload(payload, { requireTarget = true } = {}) {
    const planName = String(payload.planName || "").trim();
    if (!planName) return "FBA货件名不能为空。";
    if (Array.from(planName).length > 35) return "FBA货件名最多 35 个字符。";
    if (requireTarget && !String(payload.targetWarehouseCode || "").trim()) return "确认新建时必须填写目标 FBA 仓库代码。";
    if (!payload.inboundPlanItems?.[0]?.msku) return "MSKU 不能为空。";
    if (!Number(payload.boxCount || 0)) return "箱数必须大于 0。";
    if (payload.positionType === "1" && !hasCompleteFbaBoxSpec({ boxDimensions: payload.boxDimensions, boxWeight: payload.boxWeight })) {
      return "先装箱再分仓需要外箱规格：请填写外箱长、外箱宽、外箱高、外箱重量。";
    }
    if (!payload.deliveryPreferences?.shipDate) return "请选择发货时间。";
    if (!payload.deliveryPreferences?.deliveryDate) return "请选择送达时间。";
    if (payload.deliveryPreferences.deliveryDate < payload.deliveryPreferences.shipDate) return "送达时间不能早于发货时间。";
    return "";
  }

  function getFbaNotificationPolicy() {
    const value = fieldValue("input[name='fba-notification-policy']:checked", "", root);
    return ["all", "none"].includes(value) ? value : "matched";
  }

  function buildFbaPayload(overrides = {}) {
    const selectedShops = getSelectedFbaShops() || [];
    const firstShop = selectedShops[0];
    const sid = Number(firstShop?.sid);
    if (!firstShop || !String(firstShop.name || "").trim() || !Number.isInteger(sid) || sid <= 0) {
      throw new Error("请选择有效店铺。");
    }
    syncFbaQuantityFields();
    const boxCount = Number(fbaValue("#fba-box-count") || 0);
    const packQuantity = Number(fbaValue("#fba-pack-quantity") || 0);
    const quantity = boxCount > 0 && packQuantity > 0 ? boxCount * packQuantity : Number(fbaValue("#fba-quantity") || 0);
    const boxSpec = readFbaBoxSpecFromForm();
    const selectedMsku = findSelectedFbaMskuOption();
    const transportationKeyword = fbaValue("#fba-transportation-keyword") || "海运";
    return {
      shopName: firstShop.name,
      sid,
      shop: {
        name: firstShop.name,
        sid,
        displayName: firstShop.displayName,
        country: firstShop.country,
      },
      shops: selectedShops.map((shop) => ({
        name: shop.name,
        sid: Number(shop.sid),
        displayName: shop.displayName,
      })),
      useBrandAddress: true,
      email: "",
      planName: fbaValue("#fba-plan-name"),
      positionType: fbaValue("#fba-position-type") || "1",
      remark: "探嘉BI目标仓测试，仅查询实际仓库代码",
      targetWarehouseCode: fbaValue("#fba-target-warehouse"),
      cancelAfterPreview: overrides.cancelAfterPreview ?? true,
      scheduleEnabled: checkedField("#fba-schedule-enabled", root),
      notificationEnabled: getFbaNotificationPolicy() !== "none",
      notificationPolicy: getFbaNotificationPolicy(),
      scheduleMode: "time",
      activeStartDate: fbaValue("#fba-active-start-date"),
      activeEndDate: fbaValue("#fba-active-end-date"),
      startDay: 0,
      endDay: 6,
      startHour: readHour("#fba-start-time", 0),
      endHour: readEndHour("#fba-end-time", 24),
      runIntervalMinutes: Number(fbaValue("#fba-task-interval") || 20),
      boxCount,
      packQuantity,
      boxDimensions: boxSpec.boxDimensions,
      boxWeight: boxSpec.boxWeight,
      boxSource: selectedMsku?.boxSource || "manual",
      deliveryPreferences: {
        shipDate: fbaValue("#fba-ship-date") || defaultFbaShipDate(),
        deliveryDate: fbaValue("#fba-delivery-date") || defaultFbaDeliveryDate(fbaValue("#fba-ship-date") || defaultFbaShipDate()),
        shipAfterDays: 10,
        deliveryAfterShipDays: 10,
        shippingMode: normalizeFbaShippingModeForForm(fbaValue("#fba-shipping-mode"), transportationKeyword),
        shippingSolution: fbaValue("#fba-shipping-solution") || "USE_YOUR_OWN_CARRIER",
        transportationKeyword,
      },
      inboundPlanItems: [
        {
          labelOwner: "SELLER",
          msku: fbaValue("#fba-msku"),
          prepOwner: "SELLER",
          quantity,
        },
      ],
    };
  }

  async function createFbaTask() {
    const button = query("#fba-add-task-button");
    const isEditing = Boolean(editingFbaTaskId);
    const restoreButton = setButtonBusy(button, isEditing ? "保存中" : "新增中", isEditing ? "保存修改" : "确认新建", { disable: false });
    setText("#fba-status", isEditing ? "正在保存刷仓任务" : "正在新增刷仓任务", root);

    const payload = buildFbaPayload();
    const validationError = validateFbaPayload(payload, { requireTarget: true });
    if (validationError) {
      setText("#fba-status", `${isEditing ? "保存" : "新增"}失败：${validationError}`, root);
      restoreButton();
      alertImpl(validationError);
      return;
    }
    payload.targetWarehouseCode = String(payload.targetWarehouseCode || "").trim().toUpperCase();
    payload.quantity = Number(payload.inboundPlanItems?.[0]?.quantity || 0);
    payload.boxCount = Number(payload.boxCount || 0);
    payload.packQuantity = Number(payload.packQuantity || 0);
    payload.msku = payload.inboundPlanItems?.[0]?.msku || "";
    payload.runIntervalMinutes = Number(fbaValue("#fba-task-interval") || 20);

    try {
      await saveFbaBoxTemplateIfNeeded(payload);
      const response = await fetchImpl(isEditing ? `/api/fba/sta/tasks/${encodeURIComponent(editingFbaTaskId)}` : "/api/fba/sta/tasks", {
        method: isEditing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      renderFbaAutomationState(data.state);
      setText("#fba-status", isEditing ? "刷仓任务已更新" : `已新增 ${data.tasks?.length || 0} 个刷仓任务`, root);
      closeFbaTaskModal();
    } catch (error) {
      setText("#fba-status", `${isEditing ? "保存" : "新增"}失败：${error.message}`, root);
    } finally {
      restoreButton();
    }
  }

  async function updateFbaTask(id, payload) {
    const response = await fetchImpl(`/api/fba/sta/tasks/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    renderFbaAutomationState(data.state);
  }

  async function runFbaTask(id) {
    setText("#fba-status", "正在运行一次刷仓任务", root);
    let finished = false;
    const poll = async () => {
      if (finished) return;
      await loadFbaAutomationState();
      if (!finished) timer.setTimeout(poll, 3000);
    };
    timer.setTimeout(poll, 600);
    try {
      const response = await fetchImpl(`/api/fba/sta/tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      if (data.result) renderFbaResult(data.result);
      else setText("#fba-status", data.message || data.error || "任务已提交", root);
    } finally {
      finished = true;
      await loadFbaAutomationState();
    }
  }

  async function deleteFbaTask(id) {
    const response = await fetchImpl(`/api/fba/sta/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `API ${response.status}`);
    renderFbaAutomationState(data.state);
  }

  async function runFbaWarehouseProbe() {
    const button = query("#fba-run-test-button");
    const restoreButton = setButtonBusy(button, "测试中", "测试刷仓", { disable: false });
    setText("#fba-status", "正在创建 STA 并查询仓库", root);
    const payload = buildFbaPayload({ cancelAfterPreview: true });
    const validationError = validateFbaPayload(payload, { requireTarget: false });
    if (validationError) {
      setText("#fba-status", `测试失败：${validationError}`, root);
      restoreButton();
      alertImpl(validationError);
      return;
    }
    payload.cancelAfterPreview = confirmImpl("测试刷仓完成后是否取消 STA 任务？\n\n选择“确定”将测试后取消；选择“取消”将保留任务。");
    closeFbaTaskModal();

    try {
      await saveFbaBoxTemplateIfNeeded(payload);
      const response = await fetchImpl("/api/fba/sta/warehouse-probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        renderFbaResult({
          ok: false,
          status: response.status,
          ...result,
        });
        return;
      }
      renderFbaResult(result);
    } catch (error) {
      renderFbaResult({ ok: false, error: error.message });
    } finally {
      restoreButton();
    }
  }

  function setupFbaTaskForm() {
    bind(root, "#fba-open-task-modal-button", "click", openFbaTaskModal);
    bind(root, "#fba-close-task-modal-button", "click", closeFbaTaskModal);
    bindBackdropClose(root, "#fba-task-modal", closeFbaTaskModal);
    bind(root, "#fba-add-task-button", "click", createFbaTask);
    bind(root, "#fba-run-test-button", "click", runFbaWarehouseProbe);
    bind(root, "#fba-add-schedule-point", "click", () => {
      alertImpl("当前版本支持 1 个刷仓时间段；需要多时间段时可以新建多个任务。");
    });
    bind(root, "#fba-target-warehouse", "input", (event) => {
      event.target.value = String(event.target.value || "").trim().toUpperCase();
    });
    bind(root, "#fba-ship-date", "change", () => syncFbaDeliveryDate({ force: true }));
    bind(root, "#fba-delivery-date", "change", () => syncFbaDeliveryDate());
    bind(root, "#fba-transportation-keyword", "change", () => {
      const mode = query("#fba-shipping-mode");
      if (mode) mode.value = normalizeFbaShippingModeForForm(mode.value, fbaValue("#fba-transportation-keyword"));
    });
  }

  return {
    buildFbaPayload,
    closeFbaTaskModal,
    createFbaTask,
    deleteFbaTask,
    normalizeFbaShippingModeForForm,
    openFbaTaskModal,
    runFbaTask,
    runFbaWarehouseProbe,
    setFbaInputValue,
    setupFbaTaskForm,
    syncFbaDeliveryDate,
    updateFbaTask,
    validateFbaPayload,
  };
}
