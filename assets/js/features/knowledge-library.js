const KNOWLEDGE_CATEGORIES = [
  { id: "operations", name: "运营", fallbackFolder: "运营资料" },
  { id: "product", name: "产品", fallbackFolder: "产品资料" },
  { id: "enterprise", name: "企业内部", fallbackFolder: "制度流程" },
];

const KNOWLEDGE_BUILT_IN_DOCUMENTS = [];

export function createKnowledgeLibraryFeature({
  root = globalThis.document,
  bind,
  bindAll,
  bindBackdropClose,
  closestTarget,
  escapeHtml,
  fieldValue,
  formatCompactDateTime,
  normalizeText,
  renderTableMessage,
  setActiveElementState,
  setButtonBusy,
  setModalOpenState,
  setStatusMessage,
  trimmedFieldValue,
} = {}) {
  let knowledgeDocuments = [];
  let knowledgeBrowserState = { category: "", folder: "", query: "" };
  let knowledgeExpandedCategories = new Set(KNOWLEDGE_CATEGORIES.map((item) => item.id));

  function knowledgeCategoryName(categoryId) {
    return KNOWLEDGE_CATEGORIES.find((item) => item.id === categoryId)?.name || categoryId || "-";
  }

  function setKnowledgeLibraryStatus(message, tone = "") {
    setStatusMessage("#knowledge-library-status", message, tone, root);
  }

  function setKnowledgeAdminStatus(message, tone = "") {
    setStatusMessage("#knowledge-admin-status", message, tone, root);
  }

  function renderKnowledgeFolderOptions(documents = knowledgeDocuments) {
    const datalist = root?.querySelector?.("#knowledge-folder-options");
    if (!datalist) return;
    const folders = [...new Set(documents.map((item) => String(item.folder || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    datalist.innerHTML = folders.map((folder) => `<option value="${escapeHtml(folder)}"></option>`).join("");
  }

  function allKnowledgeDocuments() {
    return [
      ...KNOWLEDGE_BUILT_IN_DOCUMENTS,
      ...knowledgeDocuments.map((item) => ({
        ...item,
        owner: item.createdBy || "管理员",
      })),
    ];
  }

  function knowledgeFoldersFor(categoryId, documents = allKnowledgeDocuments()) {
    const category = KNOWLEDGE_CATEGORIES.find((item) => item.id === categoryId);
    const folders = [...new Set(documents
      .filter((item) => item.category === categoryId)
      .map((item) => item.folder || category?.fallbackFolder || "未分组"))];
    if (category?.fallbackFolder && !folders.includes(category.fallbackFolder)) folders.unshift(category.fallbackFolder);
    return folders.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  function knowledgeDocumentsInScope(documents = allKnowledgeDocuments()) {
    const query = normalizeText(knowledgeBrowserState.query).toLowerCase();
    return documents.filter((item) => {
      if (knowledgeBrowserState.category && item.category !== knowledgeBrowserState.category) return false;
      if (knowledgeBrowserState.folder && item.folder !== knowledgeBrowserState.folder) return false;
      if (!query) return true;
      return `${item.title || ""} ${item.folder || ""} ${knowledgeCategoryName(item.category)}`.toLowerCase().includes(query);
    });
  }

  function knowledgeFileDate(value) {
    if (!value) return "-";
    if (value === "内置文档") return value;
    return formatCompactDateTime(value);
  }

  function knowledgeHostLabel(item) {
    if (item.builtinCourse) return "BI 内置全文";
    try {
      return new URL(item.url).hostname || "外部链接";
    } catch {
      return "外部链接";
    }
  }

  function knowledgeFolderRow({ category, folder, count }) {
    const categoryName = knowledgeCategoryName(category);
    const name = category ? (folder ? `${categoryName} / ${folder}` : categoryName) : folder;
    return `
      <button class="knowledge-file-row knowledge-file-row-button" type="button" data-knowledge-category="${escapeHtml(category || "")}" data-knowledge-folder="${escapeHtml(folder || "")}" role="row">
        <span role="cell"><i class="knowledge-file-icon folder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg></i><strong>${escapeHtml(name)}</strong></span>
        <span role="cell">团队知识库</span>
        <span role="cell">${count ? `${count} 篇文档` : "待补充"}</span>
        <span role="cell">›</span>
      </button>
    `;
  }

  function knowledgeDocumentTitleButton(item) {
    const attributes = item.builtinCourse
      ? `data-knowledge-course="${escapeHtml(item.builtinCourse)}"`
      : `data-knowledge-url="${escapeHtml(item.url)}" data-knowledge-title="${escapeHtml(item.title || "外部文档")}"`;
    return `
      <button class="knowledge-doc-title-button" type="button" ${attributes}>
        <i class="knowledge-file-icon doc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9.5 12h5M9.5 15h5M9.5 18h3"/></svg></i>
        <span><strong>${escapeHtml(item.title || "-")}</strong><small>${escapeHtml(knowledgeHostLabel(item))}</small></span>
      </button>
    `;
  }

  function knowledgeDocumentRow(item) {
    return `
      <div class="knowledge-file-row" role="row">
        <span role="cell">${knowledgeDocumentTitleButton(item)}</span>
        <span role="cell">${escapeHtml(item.owner || "管理员")}</span>
        <span role="cell">${escapeHtml(knowledgeFileDate(item.updatedAt || item.createdAt))}</span>
        <span role="cell"></span>
      </div>
    `;
  }

  function renderKnowledgeSidebar(documents = allKnowledgeDocuments()) {
    const tree = root?.querySelector?.("#knowledge-sidebar-tree");
    if (!tree) return;
    tree.innerHTML = KNOWLEDGE_CATEGORIES.map((category) => {
      const folders = knowledgeFoldersFor(category.id, documents);
      const categoryActive = knowledgeBrowserState.category === category.id && !knowledgeBrowserState.folder;
      const expanded = knowledgeExpandedCategories.has(category.id);
      return `
        <section class="knowledge-tree-group ${expanded ? "is-open" : "is-collapsed"}">
          <button class="${categoryActive ? "active" : ""}" type="button" data-knowledge-tree-category="${escapeHtml(category.id)}" aria-expanded="${expanded}">
            <span class="knowledge-tree-caret">${expanded ? "⌄" : "›"}</span>
            <i class="knowledge-tree-folder" aria-hidden="true"></i>
            <strong>${escapeHtml(category.name)}</strong>
          </button>
          <div ${expanded ? "" : "hidden"}>
            ${folders.map((folder) => {
              const docs = documents.filter((item) => item.category === category.id && item.folder === folder);
              const folderActive = knowledgeBrowserState.category === category.id && knowledgeBrowserState.folder === folder;
              return `<button class="${folderActive ? "active" : ""}" type="button" data-knowledge-category="${escapeHtml(category.id)}" data-knowledge-folder="${escapeHtml(folder)}"><span></span>${escapeHtml(folder)}<small>${docs.length}</small></button>`;
            }).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  function renderKnowledgeFileRows(documents = allKnowledgeDocuments()) {
    const rows = root?.querySelector?.("#knowledge-file-rows");
    const title = root?.querySelector?.("#knowledge-current-title");
    const path = root?.querySelector?.("#knowledge-current-path");
    if (!rows) return;

    const query = normalizeText(knowledgeBrowserState.query);
    const scopedDocs = knowledgeDocumentsInScope(documents);
    if (title) title.textContent = knowledgeBrowserState.folder || (knowledgeBrowserState.category ? knowledgeCategoryName(knowledgeBrowserState.category) : "知识库目录");
    if (path) {
      path.textContent = [
        "知识库",
        knowledgeBrowserState.category ? knowledgeCategoryName(knowledgeBrowserState.category) : "全部目录",
        knowledgeBrowserState.folder,
        query ? `搜索：${query}` : "",
      ].filter(Boolean).join(" / ");
    }

    if (query || knowledgeBrowserState.folder) {
      rows.innerHTML = scopedDocs.length
        ? scopedDocs.map(knowledgeDocumentRow).join("")
        : `<div class="knowledge-table-empty">没有匹配的文档。</div>`;
    } else if (knowledgeBrowserState.category) {
      const folders = knowledgeFoldersFor(knowledgeBrowserState.category, documents);
      rows.innerHTML = folders.map((folder) => knowledgeFolderRow({
        category: knowledgeBrowserState.category,
        folder,
        count: documents.filter((item) => item.category === knowledgeBrowserState.category && item.folder === folder).length,
      })).join("");
    } else {
      rows.innerHTML = KNOWLEDGE_CATEGORIES.map((category) => knowledgeFolderRow({
        category: category.id,
        folder: "",
        count: documents.filter((item) => item.category === category.id).length,
      })).join("");
    }
  }

  function closeKnowledgeExternalDocument() {
    const panel = root?.querySelector?.("#knowledge-embed-panel");
    const frame = root?.querySelector?.("#knowledge-embed-frame");
    if (frame) frame.src = "about:blank";
    if (panel) panel.hidden = true;
  }

  function renderKnowledgeLibrary(documents = knowledgeDocuments) {
    const total = documents.length;
    const allDocs = allKnowledgeDocuments();
    renderKnowledgeSidebar(allDocs);
    renderKnowledgeFileRows(allDocs);
    setKnowledgeLibraryStatus(total ? `共 ${total} 篇文档` : "暂无文档", total ? "success" : "");
  }

  function handleKnowledgeSidebarTreeClick(event) {
    const categoryButton = closestTarget(event, "[data-knowledge-tree-category]");
    if (categoryButton) {
      closeKnowledgeExternalDocument();
      const category = categoryButton.dataset.knowledgeTreeCategory || "";
      if (knowledgeExpandedCategories.has(category)) {
        knowledgeExpandedCategories.delete(category);
      } else {
        knowledgeExpandedCategories.add(category);
      }
      knowledgeBrowserState.category = category;
      knowledgeBrowserState.folder = "";
      renderKnowledgeLibrary();
      return;
    }

    const folderButton = closestTarget(event, "[data-knowledge-category]");
    if (!folderButton) return;
    closeKnowledgeExternalDocument();
    knowledgeBrowserState.category = folderButton.dataset.knowledgeCategory || "";
    knowledgeBrowserState.folder = folderButton.dataset.knowledgeFolder || "";
    if (knowledgeBrowserState.category) knowledgeExpandedCategories.add(knowledgeBrowserState.category);
    renderKnowledgeLibrary();
  }

  function openKnowledgeCourse(id) {
    closeKnowledgeExternalDocument();
    const course = root?.querySelector?.(`#${CSS.escape(id)}`);
    if (!course) return;
    course.open = true;
    course.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openKnowledgeExternalDocument({ title, url }) {
    const panel = root?.querySelector?.("#knowledge-embed-panel");
    const frame = root?.querySelector?.("#knowledge-embed-frame");
    const titleNode = root?.querySelector?.("#knowledge-embed-title");
    const urlNode = root?.querySelector?.("#knowledge-embed-url");
    const externalLink = root?.querySelector?.("#knowledge-embed-external");
    if (!panel || !frame || !url) return;

    frame.src = "about:blank";
    if (titleNode) titleNode.textContent = title || "外部文档";
    if (urlNode) urlNode.textContent = knowledgeHostLabel({ url });
    if (externalLink) externalLink.href = url;
    panel.hidden = false;
    frame.src = url;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleKnowledgeFileRowsClick(event) {
    const courseButton = closestTarget(event, "[data-knowledge-course]");
    if (courseButton) {
      openKnowledgeCourse(courseButton.dataset.knowledgeCourse || "");
      return;
    }

    const urlButton = closestTarget(event, "[data-knowledge-url]");
    if (urlButton) {
      openKnowledgeExternalDocument({
        title: urlButton.dataset.knowledgeTitle || "外部文档",
        url: urlButton.dataset.knowledgeUrl || "",
      });
      return;
    }

    const folderButton = closestTarget(event, "[data-knowledge-category][data-knowledge-folder]");
    if (!folderButton) return;
    closeKnowledgeExternalDocument();
    knowledgeBrowserState.category = folderButton.dataset.knowledgeCategory || "";
    knowledgeBrowserState.folder = folderButton.dataset.knowledgeFolder || "";
    renderKnowledgeLibrary();
  }

  async function loadKnowledgeLibrary({ renderAdmin = false } = {}) {
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `API ${response.status}`);
      knowledgeDocuments = Array.isArray(data.documents) ? data.documents : [];
      renderKnowledgeLibrary(knowledgeDocuments);
      renderKnowledgeFolderOptions(knowledgeDocuments);
      if (renderAdmin || root?.querySelector?.("#knowledge-admin-table")) {
        renderKnowledgeAdminTable(knowledgeDocuments);
        setKnowledgeAdminStatus("录入标题、目录、文件夹和外部文档链接");
      }
    } catch (error) {
      renderKnowledgeLibrary([]);
      if (renderAdmin) renderKnowledgeAdminTable([]);
      setKnowledgeLibraryStatus(error.message || "知识库读取失败", "danger");
      if (renderAdmin) setKnowledgeAdminStatus(error.message || "知识库读取失败", "danger");
    }
  }

  async function openKnowledgeDocumentModal() {
    const modal = root?.querySelector?.("#knowledge-document-modal");
    if (!modal) return;
    setModalOpenState(modal, true, root);
    setKnowledgeAdminStatus("录入标题、目录、文件夹和外部文档链接");
    await loadKnowledgeLibrary({ renderAdmin: true });
    globalThis.setTimeout(() => root?.querySelector?.("#knowledge-document-title")?.focus(), 50);
  }

  function closeKnowledgeDocumentModal() {
    const modal = root?.querySelector?.("#knowledge-document-modal");
    if (!modal) return;
    setModalOpenState(modal, false, root);
  }

  function renderKnowledgeAdminTable(documents = knowledgeDocuments) {
    const table = root?.querySelector?.("#knowledge-admin-table");
    if (!table) return;
    if (!documents.length) {
      renderTableMessage(table, 6, "暂无外部文档。录入钉钉文档链接后会显示在前台知识库。", root);
      return;
    }
    table.innerHTML = documents.map((doc) => `
      <tr>
        <td>${escapeHtml(knowledgeCategoryName(doc.category))}</td>
        <td>${escapeHtml(doc.folder || "-")}</td>
        <td><strong>${escapeHtml(doc.title || "-")}</strong></td>
        <td><a class="table-link" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">打开</a></td>
        <td>${escapeHtml(formatCompactDateTime(doc.updatedAt || doc.createdAt))}</td>
        <td><button class="table-action danger" type="button" data-knowledge-delete="${escapeHtml(doc.id)}">删除</button></td>
      </tr>
    `).join("");
  }

  function handleKnowledgeAdminTableClick(event) {
    const deleteButton = closestTarget(event, "[data-knowledge-delete]");
    if (deleteButton) deleteKnowledgeDocument(deleteButton.dataset.knowledgeDelete || "");
  }

  function resetKnowledgeDocumentForm() {
    root?.querySelector?.("#knowledge-document-form")?.reset();
    setKnowledgeAdminStatus("录入标题、目录、文件夹和外部文档链接");
  }

  async function submitKnowledgeDocumentForm(event) {
    event.preventDefault();
    const button = root?.querySelector?.("#knowledge-document-save");
    const payload = {
      title: trimmedFieldValue("#knowledge-document-title", "", root),
      category: fieldValue("#knowledge-document-category", "operations", root) || "operations",
      folder: trimmedFieldValue("#knowledge-document-folder", "", root),
      url: trimmedFieldValue("#knowledge-document-url", "", root),
    };
    if (!payload.title || !payload.folder || !payload.url) {
      setKnowledgeAdminStatus("请填写标题、文件夹和外部文档链接。", "danger");
      return;
    }
    const restoreButton = setButtonBusy(button, "保存中...", "上传文档", { disable: false });
    try {
      const response = await fetch("/api/admin/knowledge/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      resetKnowledgeDocumentForm();
      await loadKnowledgeLibrary({ renderAdmin: true });
      setKnowledgeAdminStatus("知识库文档已上传。", "success");
    } catch (error) {
      setKnowledgeAdminStatus(error.message || "保存失败", "danger");
    } finally {
      restoreButton();
    }
  }

  async function deleteKnowledgeDocument(id) {
    if (!id || !globalThis.confirm("确定删除这条知识库文档记录吗？不会删除钉钉原文档。")) return;
    try {
      const response = await fetch(`/api/admin/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "删除失败");
      await loadKnowledgeLibrary({ renderAdmin: true });
      setKnowledgeAdminStatus("知识库文档记录已删除。", "success");
    } catch (error) {
      setKnowledgeAdminStatus(error.message || "删除失败", "danger");
    }
  }

  function setupKnowledgeLibrary() {
    bind(root, "#knowledge-document-form", "submit", submitKnowledgeDocumentForm);
    bind(root, "#knowledge-document-reset", "click", resetKnowledgeDocumentForm);
    bind(root, "#knowledge-search", "input", (event) => {
      closeKnowledgeExternalDocument();
      knowledgeBrowserState.query = event.target.value || "";
      renderKnowledgeLibrary();
    });
    bind(root, "#knowledge-refresh-button", "click", () => {
      closeKnowledgeExternalDocument();
      loadKnowledgeLibrary();
    });
    bind(root, "#knowledge-toolbar-refresh", "click", () => {
      closeKnowledgeExternalDocument();
      loadKnowledgeLibrary();
    });
    bind(root, "#knowledge-embed-close", "click", closeKnowledgeExternalDocument);
    bind(root, "#knowledge-open-admin-upload", "click", openKnowledgeDocumentModal);
    bind(root, "#knowledge-document-close-modal", "click", closeKnowledgeDocumentModal);
    bindBackdropClose(root, "#knowledge-document-modal", closeKnowledgeDocumentModal);
    bind(root, "#knowledge-sidebar-tree", "click", handleKnowledgeSidebarTreeClick);
    bind(root, "#knowledge-file-rows", "click", handleKnowledgeFileRowsClick);
    bind(root, "#knowledge-admin-table", "click", handleKnowledgeAdminTableClick);
    bindAll(root, "[data-knowledge-scope]", "click", function handleKnowledgeScopeClick() {
      const button = this;
      setActiveElementState("[data-knowledge-scope]", button, "active", root);
      const scope = button.dataset.knowledgeScope || "all";
      knowledgeBrowserState = { category: "", folder: "", query: "" };
      const search = root?.querySelector?.("#knowledge-search");
      if (search) search.value = "";
      if (scope === "wiki") knowledgeBrowserState.category = "operations";
      renderKnowledgeLibrary();
    });
  }

  return {
    closeKnowledgeExternalDocument,
    loadKnowledgeLibrary,
    renderKnowledgeLibrary,
    setupKnowledgeLibrary,
  };
}
