/** Reconcile stable table regions so selecting a card preserves its DOM and image. */
export function patchTableElement(current: Element, next: Element) {
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  const key = (node: Node): string | undefined => {
    if (!(node instanceof Element)) return undefined;
    if (node.hasAttribute("data-auto-card")) return `card:${node.getAttribute("data-owner")}:${node.getAttribute("data-auto-card")}`;
    if (node.hasAttribute("data-target-slot")) return `slot:${node.getAttribute("data-target-player")}:${node.getAttribute("data-target-slot")}`;
    return undefined;
  };
  const available = [...current.childNodes];
  let cursor: ChildNode | null = current.firstChild;
  for (const desired of [...next.childNodes]) {
    const id = key(desired);
    const match = available.find(node => id ? key(node) === id : !key(node) && node.nodeType === desired.nodeType
      && (!(node instanceof Element) || desired instanceof Element && node.tagName === desired.tagName));
    if (match) {
      available.splice(available.indexOf(match), 1);
      if (match !== cursor) current.insertBefore(match, cursor);
      if (match instanceof Element && desired instanceof Element) patchTableElement(match, desired);
      else if (match.textContent !== desired.textContent) match.textContent = desired.textContent;
      cursor = match.nextSibling;
    } else {
      current.insertBefore(desired, cursor);
    }
  }
  for (const unused of available) unused.remove();
}
