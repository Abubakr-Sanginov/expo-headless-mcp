import Reconciler from 'react-reconciler';

let nextId = 1;

const makeNode = (type, props) => ({
  id: nextId++,
  type,
  props: props || {},
  children: [],
  parent: null,
  scrollY: 0,
});

const detach = (child) => {
  if (child.parent) {
    const i = child.parent.children.indexOf(child);
    if (i >= 0) child.parent.children.splice(i, 1);
    child.parent = null;
  }
};

const append = (parent, child) => {
  detach(child);
  child.parent = parent;
  parent.children.push(child);
};

const insertBefore = (parent, child, before) => {
  detach(child);
  child.parent = parent;
  const i = parent.children.indexOf(before);
  if (i < 0) parent.children.push(child);
  else parent.children.splice(i, 0, child);
};

const host = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  getRootHostContext: () => ({}),
  getChildHostContext: (ctx) => ctx,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  getPublicInstance: (i) => i,
  getCurrentEventPriority: () => 16,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},

  createInstance: (type, props) => makeNode(type, props),
  createTextInstance: (text) => ({ ...makeNode('raw', {}), text }),
  appendInitialChild: append,
  appendChild: append,
  appendChildToContainer: append,
  insertBefore,
  insertInContainerBefore: insertBefore,
  removeChild: (_p, c) => detach(c),
  removeChildFromContainer: (_p, c) => detach(c),
  clearContainer: (c) => {
    c.children.forEach((k) => (k.parent = null));
    c.children.length = 0;
  },

  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  prepareUpdate: () => true,
  commitUpdate: (node, _payload, _type, _old, next) => {
    node.props = next;
  },
  commitTextUpdate: (node, _old, text) => {
    node.text = text;
  },
  resetTextContent: () => {},
  hideInstance: (n) => (n.hidden = true),
  unhideInstance: (n) => (n.hidden = false),
  hideTextInstance: (n) => (n.hidden = true),
  unhideTextInstance: (n) => (n.hidden = false),
};

export const reconciler = Reconciler(host);

export const createRoot = (onError) => {
  const container = makeNode('root', {});
  const fiber = reconciler.createContainer(container, 0, null, false, null, '', onError, null);
  return {
    container,
    render: (element) => reconciler.updateContainer(element, fiber, null, () => {}),
    unmount: () => reconciler.updateContainer(null, fiber, null, () => {}),
  };
};
