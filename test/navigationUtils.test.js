import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationUtils } from "../assets/js/navigation-utils.js";

function makeClassList() {
  return {
    values: new Set(),
    toggle(name, force) {
      if (force) this.values.add(name);
      else this.values.delete(name);
    },
    contains(name) {
      return this.values.has(name);
    },
  };
}

function makeNavGroup(active) {
  return {
    classList: makeClassList(),
    querySelector(selector) {
      if (selector === ".nav-item.active" && active) return {};
      return null;
    },
  };
}

function makeNavGroupTitle(group) {
  return {
    closest(selector) {
      return selector === ".nav-group" ? group : null;
    },
  };
}

function makeRoot(extra = {}) {
  return {
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  };
}

function createNavigation(overrides = {}) {
  return createNavigationUtils({
    root: makeRoot(),
    bind: () => null,
    bindEventTarget: () => null,
    closestTarget: () => null,
    clickVisibleElement: (element) => element,
    setExpandedClassState: () => null,
    ...overrides,
  });
}

test("navigation utils click visible nav items through the shared helper", () => {
  const navItems = {
    ".nav-item[data-view=\"sales\"]": { dataset: { view: "sales" } },
  };
  const clicked = [];
  const navigation = createNavigation({
    root: makeRoot({
      querySelector: (selector) => navItems[selector] || null,
      querySelectorAll: () => [],
    }),
    clickVisibleElement: (element) => {
      clicked.push(element);
      return element || null;
    },
  });

  assert.equal(navigation.clickVisibleNavItem("sales"), navItems[".nav-item[data-view=\"sales\"]"]);
  assert.equal(navigation.clickVisibleNavItem("missing"), null);
  assert.equal(navigation.clickVisibleNavItem(""), null);
  assert.deepEqual(clicked, [navItems[".nav-item[data-view=\"sales\"]"], null]);
});

test("navigation utils synchronize active nav group state", () => {
  const activeGroup = makeNavGroup(true);
  const inactiveGroup = makeNavGroup(false);
  const navigation = createNavigation({
    root: makeRoot({
      querySelector: () => null,
      querySelectorAll: (selector) => (selector === ".nav-group" ? [activeGroup, inactiveGroup] : []),
    }),
    clickVisibleElement: (element) => element,
  });

  navigation.updateNavGroupActiveStates();

  assert.equal(activeGroup.classList.contains("is-active"), true);
  assert.equal(inactiveGroup.classList.contains("is-active"), false);
});

test("navigation utils own the delegated nav click binding", () => {
  const globalState = {};
  const nav = {
    contains(target) {
      return target?.insideNav === true;
    },
  };
  const navButton = { insideNav: true, dataset: { view: "sales" } };
  const bindCalls = [];
  const handled = [];
  const navigation = createNavigation({
    root: makeRoot(),
    global: globalState,
    bind: (...args) => {
      bindCalls.push(args);
      return nav;
    },
    closestTarget: (event, selector) => (selector === ".nav-item[data-view]" ? event.target : null),
  });

  assert.equal(navigation.setupNavClickBinding((button) => handled.push(button)), nav);
  bindCalls[0][3]({ currentTarget: nav, target: navButton });
  bindCalls[0][3]({ currentTarget: nav, target: { insideNav: false } });

  assert.deepEqual(bindCalls.map(([, selector, eventName]) => [selector, eventName]), [[".nav", "click"]]);
  assert.deepEqual(handled, [navButton]);
  assert.equal(globalState.__tanjiaAppNavigationReady, true);
});

test("navigation utils does not bind nav clicks more than once", () => {
  let bindCount = 0;
  const globalState = { __tanjiaAppNavigationReady: true };
  const navigation = createNavigation({
    global: globalState,
    bind: () => {
      bindCount += 1;
      return {};
    },
  });

  assert.equal(navigation.setupNavClickBinding(() => {}), null);
  assert.equal(bindCount, 0);
});

test("navigation utils own nav group title expansion binding", () => {
  const globalState = {};
  const group = makeNavGroup(false);
  const title = makeNavGroupTitle(group);
  const appShell = { classList: { contains: () => false } };
  const bindCalls = [];
  const expandedCalls = [];
  const navigation = createNavigation({
    root: makeRoot({
      querySelector: (selector) => (selector === ".app-shell" ? appShell : null),
      querySelectorAll: (selector) => (selector === ".nav-group-title" ? [title] : []),
    }),
    global: globalState,
    bindEventTarget: (...args) => {
      bindCalls.push(args);
      return args[0];
    },
    setExpandedClassState: (...args) => expandedCalls.push(args),
  });

  assert.deepEqual(navigation.setupNavGroupTitleBinding(), [title]);
  bindCalls[0][2]();

  assert.deepEqual(bindCalls.map(([target, eventName]) => [target, eventName]), [[title, "click"]]);
  assert.deepEqual(expandedCalls, [[group, title, true]]);
  assert.equal(globalState.__tanjiaNavigationGroupsReady, true);
});

test("navigation utils route collapsed nav groups to the sidebar flyout", () => {
  const group = makeNavGroup(false);
  const title = makeNavGroupTitle(group);
  const flyoutCalls = [];
  const navigation = createNavigation({
    root: makeRoot({
      querySelector: (selector) => (selector === ".app-shell"
        ? { classList: { contains: (name) => name === "sidebar-collapsed" } }
        : null),
      querySelectorAll: (selector) => (selector === ".nav-group-title" ? [title] : []),
    }),
    global: {
      __tanjiaShowSidebarFlyout: (item) => flyoutCalls.push(item),
    },
    bindEventTarget: (target, eventName, handler) => {
      handler();
      return target;
    },
  });

  navigation.setupNavGroupTitleBinding();

  assert.deepEqual(flyoutCalls, [group]);
});

test("navigation utils does not bind nav group titles more than once", () => {
  let bindCount = 0;
  const navigation = createNavigation({
    global: { __tanjiaNavigationGroupsReady: true },
    bindEventTarget: () => {
      bindCount += 1;
      return {};
    },
  });

  assert.deepEqual(navigation.setupNavGroupTitleBinding(), []);
  assert.equal(bindCount, 0);
});
