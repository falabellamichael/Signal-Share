export function createUiElementRegistry(root = document) {
  const query = (selector) => root.querySelector(selector);
  const id = (value) => root.getElementById ? root.getElementById(value) : document.getElementById(value);

  return {
    query,
    id,
    bySelector: query,
    byId: id
  };
}
