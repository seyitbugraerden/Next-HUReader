/** Small hash router shared by workflow pages; no server fallback required. */
window.createRouter = function ({
  routes,
  fallback,
  canNavigate = () => true,
  onChange,
}) {
  const table = new Map(routes.map((route) => [route.path, route]));
  let current = null;
  function resolve(path) {
    const visited = new Set();
    while (true) {
      const route = table.get(path);
      if (!route || visited.has(path)) return table.get(fallback);
      visited.add(path);
      if (!route.canEnter || route.canEnter()) return route;
      path = route.redirect || fallback;
    }
  }
  function commit(
    path,
    { replace = false, render = true, focus = false } = {},
  ) {
    const route = resolve(path);
    const hash = `#${route.path}`;
    if (location.hash !== hash) {
      history[replace ? 'replaceState' : 'pushState'](history.state, '', hash);
    }
    const changed = current !== route;
    current = route;
    if (render && changed) onChange(route, { focus });
    return route;
  }
  function fromLocation() {
    if (!canNavigate() && current) {
      // Keep the URL and visible page together while an operation is running.
      commit(current.path, { replace: true, render: false });
      return;
    }
    commit(location.hash.slice(1), { replace: true, focus: true });
  }
  window.addEventListener('popstate', fromLocation);
  window.addEventListener('hashchange', fromLocation);
  return {
    start: () => commit(location.hash.slice(1), { replace: true }),
    navigate(path, options) {
      if (canNavigate()) return commit(path, options);
      return current;
    },
    reconcile: () =>
      commit(current?.path || fallback, { replace: true, render: false }),
    destroy() {
      window.removeEventListener('popstate', fromLocation);
      window.removeEventListener('hashchange', fromLocation);
    },
  };
};
