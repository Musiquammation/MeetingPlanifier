//#region node_modules/alpinejs/dist/module.esm.js
var flushPending = false;
var flushing = false;
var queue = [];
var lastFlushedIndex = -1;
var queueNeedsSort = false;
var transactionActive = false;
function scheduler(callback) {
	queueJob(callback);
}
function startTransaction() {
	transactionActive = true;
}
function commitTransaction() {
	transactionActive = false;
	queueFlush();
}
function queueJob(job) {
	if (!queue.includes(job)) {
		queue.push(job);
		if (job._x_schedulerPriority !== void 0) queueNeedsSort = true;
	}
	queueFlush();
}
function dequeueJob(job) {
	let index = queue.indexOf(job);
	if (index !== -1 && index > lastFlushedIndex) queue.splice(index, 1);
}
function queueFlush() {
	if (!flushing && !flushPending) {
		if (transactionActive) return;
		flushPending = true;
		queueMicrotask(flushJobs);
	}
}
function flushJobs() {
	flushPending = false;
	flushing = true;
	for (let i = 0; i < queue.length; i++) {
		if (queueNeedsSort) sortPendingJobs(i);
		queue[i]();
		lastFlushedIndex = i;
	}
	queue.length = 0;
	lastFlushedIndex = -1;
	queueNeedsSort = false;
	flushing = false;
}
function sortPendingJobs(start2) {
	let depths = /* @__PURE__ */ new Map();
	let sorted = queue.slice(start2).sort((a, b) => compareJobs(a, b, depths));
	for (let i = 0; i < sorted.length; i++) queue[start2 + i] = sorted[i];
	queueNeedsSort = false;
}
function compareJobs(a, b, depths) {
	if (!isStructural(a)) return isStructural(b) ? 1 : 0;
	if (!isStructural(b)) return -1;
	return getElementDepth(a._x_schedulerPriority.el, depths) - getElementDepth(b._x_schedulerPriority.el, depths) || a._x_schedulerPriority.order - b._x_schedulerPriority.order;
}
function isStructural(job) {
	return job._x_schedulerPriority !== void 0;
}
function getElementDepth(el, depths) {
	if (depths.has(el)) return depths.get(el);
	let depth = 0;
	let owner = el;
	while (el) {
		depth++;
		if (el._x_teleportBack) el = el._x_teleportBack;
		else if (typeof ShadowRoot === "function" && el.parentNode instanceof ShadowRoot) el = el.parentNode.host;
		else el = el.parentElement;
	}
	depths.set(owner, depth);
	return depth;
}
var reactive;
var effect;
var release;
var raw$1;
var nextStructuralEffectOrder = 0;
var shouldSchedule = true;
function disableEffectScheduling(callback) {
	shouldSchedule = false;
	callback();
	shouldSchedule = true;
}
function setReactivityEngine(engine) {
	reactive = engine.reactive;
	release = engine.release;
	effect = (callback) => engine.effect(callback, { scheduler: (task) => {
		if (shouldSchedule) scheduler(task);
		else task();
	} });
	raw$1 = engine.raw;
}
function overrideEffect(override) {
	effect = override;
}
function elementBoundEffect(el) {
	let cleanup = () => {};
	let wrappedEffect = (callback, options) => {
		let priority = options?.priority === "structural" ? nextStructuralEffectOrder++ : void 0;
		let effectReference = effect(callback);
		if (priority !== void 0 && effectReference !== void 0) effectReference._x_schedulerPriority = {
			el,
			order: priority
		};
		if (!el._x_effects) {
			el._x_effects = /* @__PURE__ */ new Set();
			el._x_runEffects = () => {
				el._x_effects.forEach((i) => i());
			};
		}
		el._x_effects.add(effectReference);
		cleanup = () => {
			if (effectReference === void 0) return;
			el._x_effects.delete(effectReference);
			release(effectReference);
		};
		return effectReference;
	};
	return [wrappedEffect, () => {
		cleanup();
	}];
}
function watch(getter, callback) {
	let firstTime = true;
	let oldValue;
	let oldValueJSON;
	let effectReference = effect(() => {
		let value = getter();
		let newJSON = JSON.stringify(value);
		if (!firstTime) {
			if (typeof value === "object" || value !== oldValue) {
				let previousValue = typeof oldValue === "object" ? JSON.parse(oldValueJSON) : oldValue;
				queueMicrotask(() => {
					callback(value, previousValue);
				});
			}
		}
		oldValue = value;
		oldValueJSON = newJSON;
		firstTime = false;
	});
	return () => {
		dequeueJob(effectReference);
		release(effectReference);
	};
}
async function transaction(callback) {
	startTransaction();
	try {
		await callback();
		await Promise.resolve();
	} finally {
		commitTransaction();
	}
}
var onAttributeAddeds = [];
var onElRemoveds = [];
var onElAddeds = [];
function onElAdded(callback) {
	onElAddeds.push(callback);
}
function onElRemoved(el, callback) {
	if (typeof callback === "function") {
		if (!el._x_cleanups) el._x_cleanups = [];
		el._x_cleanups.push(callback);
	} else {
		callback = el;
		onElRemoveds.push(callback);
	}
}
function onAttributesAdded(callback) {
	onAttributeAddeds.push(callback);
}
function onAttributeRemoved(el, name, callback) {
	if (!el._x_attributeCleanups) el._x_attributeCleanups = {};
	if (!el._x_attributeCleanups[name]) el._x_attributeCleanups[name] = [];
	el._x_attributeCleanups[name].push(callback);
}
function cleanupAttributes(el, names) {
	if (!el._x_attributeCleanups) return;
	Object.entries(el._x_attributeCleanups).forEach(([name, value]) => {
		if (names === void 0 || names.includes(name)) {
			value.forEach((i) => i());
			delete el._x_attributeCleanups[name];
		}
	});
}
function cleanupElement(el) {
	el._x_effects?.forEach(dequeueJob);
	while (el._x_cleanups?.length) el._x_cleanups.pop()();
}
var observer = new MutationObserver(onMutate);
var currentlyObserving = false;
function startObservingMutations() {
	observer.observe(document, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeOldValue: true
	});
	currentlyObserving = true;
}
function stopObservingMutations() {
	flushObserver();
	observer.disconnect();
	currentlyObserving = false;
}
var queuedMutations = [];
function flushObserver() {
	let records = observer.takeRecords();
	queuedMutations.push(() => records.length > 0 && onMutate(records));
	let queueLengthWhenTriggered = queuedMutations.length;
	queueMicrotask(() => {
		if (queuedMutations.length === queueLengthWhenTriggered) while (queuedMutations.length > 0) queuedMutations.shift()();
	});
}
function flushPendingMutations() {
	while (queuedMutations.length > 0) queuedMutations.shift()();
	let records = observer.takeRecords();
	if (records.length > 0) onMutate(records);
}
function mutateDom(callback) {
	if (!currentlyObserving) return callback();
	stopObservingMutations();
	try {
		return callback();
	} finally {
		startObservingMutations();
	}
}
var isCollecting = false;
var deferredMutations = [];
function deferMutations() {
	isCollecting = true;
}
function flushAndStopDeferringMutations() {
	isCollecting = false;
	onMutate(deferredMutations);
	deferredMutations = [];
}
function onMutate(mutations) {
	if (isCollecting) {
		deferredMutations = deferredMutations.concat(mutations);
		return;
	}
	let addedNodes = [];
	let removedNodes = /* @__PURE__ */ new Set();
	let addedAttributes = /* @__PURE__ */ new Map();
	let removedAttributes = /* @__PURE__ */ new Map();
	for (let i = 0; i < mutations.length; i++) {
		if (mutations[i].target._x_ignoreMutationObserver) continue;
		if (mutations[i].type === "childList") {
			mutations[i].removedNodes.forEach((node) => {
				if (node.nodeType !== 1) return;
				if (!node._x_marker) return;
				removedNodes.add(node);
			});
			mutations[i].addedNodes.forEach((node) => {
				if (node.nodeType !== 1) return;
				if (removedNodes.has(node)) {
					removedNodes.delete(node);
					return;
				}
				if (node._x_marker) return;
				addedNodes.push(node);
			});
		}
		if (mutations[i].type === "attributes") {
			let el = mutations[i].target;
			let name = mutations[i].attributeName;
			let oldValue = mutations[i].oldValue;
			let add = () => {
				if (!addedAttributes.has(el)) addedAttributes.set(el, []);
				addedAttributes.get(el).push({
					name,
					value: el.getAttribute(name)
				});
			};
			let remove2 = () => {
				if (!removedAttributes.has(el)) removedAttributes.set(el, []);
				removedAttributes.get(el).push(name);
			};
			if (el.hasAttribute(name) && oldValue === null) add();
			else if (el.hasAttribute(name)) {
				remove2();
				add();
			} else remove2();
		}
	}
	removedAttributes.forEach((attrs, el) => {
		cleanupAttributes(el, attrs);
	});
	addedAttributes.forEach((attrs, el) => {
		onAttributeAddeds.forEach((i) => i(el, attrs));
	});
	for (let node of removedNodes) {
		if (addedNodes.some((i) => i.contains(node))) continue;
		onElRemoveds.forEach((i) => i(node));
	}
	for (let node of addedNodes) {
		if (!node.isConnected) continue;
		onElAddeds.forEach((i) => i(node));
	}
	addedNodes = null;
	removedNodes = null;
	addedAttributes = null;
	removedAttributes = null;
}
function scope(node) {
	return mergeProxies(closestDataStack(node));
}
function addScopeToNode(node, data2, referenceNode) {
	node._x_dataStack = [data2, ...closestDataStack(referenceNode || node)];
	return () => {
		node._x_dataStack = node._x_dataStack.filter((i) => i !== data2);
	};
}
function closestDataStack(node) {
	if (node._x_dataStack) return node._x_dataStack;
	if (typeof ShadowRoot === "function" && node instanceof ShadowRoot) return closestDataStack(node.host);
	if (!node.parentNode) return [];
	return closestDataStack(node.parentNode);
}
function mergeProxies(objects) {
	return new Proxy({ objects }, mergeProxyTrap);
}
function keyInPrototypeChain(obj, key) {
	if (obj === null || obj === Object.prototype) return null;
	if (Object.prototype.hasOwnProperty.call(obj, key)) return obj;
	return keyInPrototypeChain(Object.getPrototypeOf(obj), key);
}
var mergeProxyTrap = {
	ownKeys({ objects }) {
		return Array.from(new Set(objects.flatMap((i) => Object.keys(i))));
	},
	has({ objects }, name) {
		if (name == Symbol.unscopables) return false;
		return objects.some((obj) => Object.prototype.hasOwnProperty.call(obj, name) || Reflect.has(obj, name));
	},
	get({ objects }, name, thisProxy) {
		if (name == "toJSON") return collapseProxies;
		return Reflect.get(objects.find((obj) => Reflect.has(obj, name)) || {}, name, thisProxy);
	},
	set({ objects }, name, value, thisProxy) {
		let target;
		for (const obj of objects) {
			target = keyInPrototypeChain(obj, name);
			if (target) break;
		}
		if (!target) target = objects[objects.length - 1];
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (descriptor?.set && descriptor?.get) return descriptor.set.call(thisProxy, value) || true;
		return Reflect.set(target, name, value);
	}
};
function collapseProxies() {
	return Reflect.ownKeys(this).reduce((acc, key) => {
		acc[key] = Reflect.get(this, key);
		return acc;
	}, {});
}
function initInterceptors(data2, cleanup = () => {}) {
	let isObject3 = (val) => typeof val === "object" && !Array.isArray(val) && val !== null;
	let recurse = (obj, basePath = "") => {
		Object.entries(Object.getOwnPropertyDescriptors(obj)).forEach(([key, { value, enumerable }]) => {
			if (enumerable === false || value === void 0) return;
			if (typeof value === "object" && value !== null && value.__v_skip) return;
			let path = basePath === "" ? key : `${basePath}.${key}`;
			if (typeof value === "object" && value !== null && value._x_interceptor) obj[key] = value.initialize(data2, path, key, cleanup);
			else if (isObject3(value) && value !== obj && !(value instanceof Element)) recurse(value, path);
		});
	};
	return recurse(data2);
}
function interceptor(callback, mutateObj = () => {}) {
	let obj = {
		initialValue: void 0,
		_x_interceptor: true,
		initialize(data2, path, key, cleanup) {
			return callback(this.initialValue, () => get(data2, path), (value) => set(data2, path, value), path, key, cleanup);
		}
	};
	mutateObj(obj);
	return (initialValue) => {
		if (typeof initialValue === "object" && initialValue !== null && initialValue._x_interceptor) {
			let initialize = obj.initialize.bind(obj);
			obj.initialize = (data2, path, key, cleanup) => {
				obj.initialValue = initialValue.initialize(data2, path, key, cleanup);
				return initialize(data2, path, key, cleanup);
			};
		} else obj.initialValue = initialValue;
		return obj;
	};
}
function get(obj, path) {
	return path.split(".").reduce((carry, segment) => carry[segment], obj);
}
function set(obj, path, value) {
	if (typeof path === "string") path = path.split(".");
	if (path.length === 1) obj[path[0]] = value;
	else if (path.length === 0) throw error;
	else if (obj[path[0]]) return set(obj[path[0]], path.slice(1), value);
	else {
		obj[path[0]] = {};
		return set(obj[path[0]], path.slice(1), value);
	}
}
var magics = {};
function magic(name, callback) {
	magics[name] = callback;
}
function injectMagics(obj, el) {
	let memoizedUtilities = getUtilities(el);
	Object.entries(magics).forEach(([name, callback]) => {
		Object.defineProperty(obj, `$${name}`, {
			get() {
				return callback(el, memoizedUtilities);
			},
			enumerable: false
		});
	});
	return obj;
}
function getUtilities(el) {
	let [utilities, cleanup] = getElementBoundUtilities(el);
	let utils = {
		interceptor,
		...utilities
	};
	onElRemoved(el, cleanup);
	return utils;
}
function tryCatch(el, expression, callback, ...args) {
	try {
		return callback(...args);
	} catch (e) {
		handleError(e, el, expression);
	}
}
function handleError(...args) {
	return errorHandler(...args);
}
var errorHandler = normalErrorHandler;
function setErrorHandler(handler4) {
	errorHandler = handler4;
}
function normalErrorHandler(error2, el, expression = void 0) {
	error2 = Object.assign(error2 ?? { message: "No error message given." }, {
		el,
		expression
	});
	console.warn(`Alpine Expression Error: ${error2.message}

${expression ? "Expression: \"" + expression + "\"\n\n" : ""}`, el);
	setTimeout(() => {
		throw error2;
	}, 0);
}
var shouldAutoEvaluateFunctions = true;
function dontAutoEvaluateFunctions(callback) {
	let cache = shouldAutoEvaluateFunctions;
	shouldAutoEvaluateFunctions = false;
	let result = callback();
	shouldAutoEvaluateFunctions = cache;
	return result;
}
function evaluate$1(el, expression, extras = {}) {
	let result;
	evaluateLater(el, expression)((value) => result = value, extras);
	return result;
}
function evaluateLater(...args) {
	return theEvaluatorFunction(...args);
}
var theEvaluatorFunction = () => {};
function setEvaluator(newEvaluator) {
	theEvaluatorFunction = newEvaluator;
}
var theRawEvaluatorFunction;
function setRawEvaluator(newEvaluator) {
	theRawEvaluatorFunction = newEvaluator;
}
function normalEvaluator(el, expression) {
	let overriddenMagics = {};
	injectMagics(overriddenMagics, el);
	let dataStack = [overriddenMagics, ...closestDataStack(el)];
	let evaluator = typeof expression === "function" ? generateEvaluatorFromFunction(dataStack, expression) : generateEvaluatorFromString(dataStack, expression, el);
	return tryCatch.bind(null, el, expression, evaluator);
}
function generateEvaluatorFromFunction(dataStack, func) {
	return (receiver = () => {}, { scope: scope2 = {}, params = [], context } = {}) => {
		if (!shouldAutoEvaluateFunctions) {
			runIfTypeOfFunction(receiver, func, mergeProxies([scope2, ...dataStack]), params);
			return;
		}
		runIfTypeOfFunction(receiver, func.apply(mergeProxies([scope2, ...dataStack]), params));
	};
}
var evaluatorMemo = {};
function generateFunctionFromString(expression, el) {
	if (evaluatorMemo[expression]) return evaluatorMemo[expression];
	let AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
	let rightSideSafeExpression = /^[\n\s]*if.*\(.*\)/.test(expression.trim()) || /^(let|const)\s/.test(expression.trim()) ? `(async()=>{ ${expression} })()` : expression;
	const safeAsyncFunction = () => {
		try {
			let func2 = new AsyncFunction(["__self", "scope"], `with (scope) { __self.result = ${rightSideSafeExpression} }; __self.finished = true; return __self.result;`);
			Object.defineProperty(func2, "name", { value: `[Alpine] ${expression}` });
			return func2;
		} catch (error2) {
			handleError(error2, el, expression);
			return Promise.resolve();
		}
	};
	let func = safeAsyncFunction();
	evaluatorMemo[expression] = func;
	return func;
}
function generateEvaluatorFromString(dataStack, expression, el) {
	let func = generateFunctionFromString(expression, el);
	return (receiver = () => {}, { scope: scope2 = {}, params = [], context } = {}) => {
		func.result = void 0;
		func.finished = false;
		let completeScope = mergeProxies([scope2, ...dataStack]);
		if (typeof func === "function") {
			let promise = func.call(context, func, completeScope).catch((error2) => handleError(error2, el, expression));
			if (func.finished) {
				runIfTypeOfFunction(receiver, func.result, completeScope, params, el);
				func.result = void 0;
			} else promise.then((result) => {
				runIfTypeOfFunction(receiver, result, completeScope, params, el);
			}).catch((error2) => handleError(error2, el, expression)).finally(() => func.result = void 0);
		}
	};
}
function runIfTypeOfFunction(receiver, value, scope2, params, el) {
	if (shouldAutoEvaluateFunctions && typeof value === "function") {
		let result = value.apply(scope2, params);
		if (result instanceof Promise) result.then((i) => runIfTypeOfFunction(receiver, i, scope2, params)).catch((error2) => handleError(error2, el, value));
		else receiver(result);
	} else if (typeof value === "object" && value instanceof Promise) value.then((i) => receiver(i));
	else receiver(value);
}
function evaluateRaw(...args) {
	return theRawEvaluatorFunction(...args);
}
function normalRawEvaluator(el, expression, extras = {}) {
	let overriddenMagics = {};
	injectMagics(overriddenMagics, el);
	let dataStack = [overriddenMagics, ...closestDataStack(el)];
	let scope2 = mergeProxies([extras.scope ?? {}, ...dataStack]);
	let params = extras.params ?? [];
	if (expression.includes("await")) {
		let AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
		return new AsyncFunction(["scope"], `with (scope) { let __result = ${/^[\n\s]*if.*\(.*\)/.test(expression.trim()) || /^(let|const)\s/.test(expression.trim()) ? `(async()=>{ ${expression} })()` : expression}; return __result }`).call(extras.context, scope2);
	} else {
		let rightSideSafeExpression = /^[\n\s]*if.*\(.*\)/.test(expression.trim()) || /^(let|const)\s/.test(expression.trim()) ? `(()=>{ ${expression} })()` : expression;
		let result = new Function(["scope"], `with (scope) { let __result = ${rightSideSafeExpression}; return __result }`).call(extras.context, scope2);
		if (typeof result === "function" && shouldAutoEvaluateFunctions) return result.apply(scope2, params);
		return result;
	}
}
var prefixAsString = "x-";
function prefix(subject = "") {
	return prefixAsString + subject;
}
function setPrefix(newPrefix) {
	prefixAsString = newPrefix;
}
var directiveHandlers = {};
function directive(name, callback) {
	directiveHandlers[name] = callback;
	return { before(directive2) {
		if (!directiveHandlers[directive2]) {
			console.warn(String.raw`Cannot find directive \`${directive2}\`. \`${name}\` will use the default order of execution`);
			return;
		}
		const pos = directiveOrder.indexOf(directive2);
		directiveOrder.splice(pos >= 0 ? pos : directiveOrder.indexOf("DEFAULT"), 0, name);
	} };
}
function directiveExists(name) {
	return Object.keys(directiveHandlers).includes(name);
}
function directives(el, attributes, originalAttributeOverride) {
	attributes = Array.from(attributes);
	if (el._x_virtualDirectives) {
		let vAttributes = Object.entries(el._x_virtualDirectives).map(([name, value]) => ({
			name,
			value
		}));
		let staticAttributes = attributesOnly(vAttributes);
		vAttributes = vAttributes.map((attribute) => {
			if (staticAttributes.find((attr) => attr.name === attribute.name)) return {
				name: `x-bind:${attribute.name}`,
				value: `"${attribute.value}"`
			};
			return attribute;
		});
		attributes = attributes.concat(vAttributes);
	}
	let transformedAttributeMap = {};
	return attributes.map(toTransformedAttributes((newName, oldName) => transformedAttributeMap[newName] = oldName)).filter(outNonAlpineAttributes).map(toParsedDirectives(transformedAttributeMap, originalAttributeOverride)).sort(byPriority).map((directive2) => {
		return getDirectiveHandler(el, directive2);
	});
}
function attributesOnly(attributes) {
	return Array.from(attributes).map(toTransformedAttributes()).filter((attr) => !outNonAlpineAttributes(attr));
}
var isDeferringHandlers = false;
var directiveHandlerStacks = /* @__PURE__ */ new Map();
var currentHandlerStackKey = Symbol();
function deferHandlingDirectives(callback) {
	isDeferringHandlers = true;
	let key = Symbol();
	currentHandlerStackKey = key;
	directiveHandlerStacks.set(key, []);
	let flushHandlers = () => {
		while (directiveHandlerStacks.get(key).length) directiveHandlerStacks.get(key).shift()();
		directiveHandlerStacks.delete(key);
	};
	let stopDeferring = () => {
		isDeferringHandlers = false;
		flushHandlers();
	};
	callback(flushHandlers);
	stopDeferring();
}
function getElementBoundUtilities(el) {
	let cleanups = [];
	let cleanup = (callback) => cleanups.push(callback);
	let [effect3, cleanupEffect2] = elementBoundEffect(el);
	cleanups.push(cleanupEffect2);
	let utilities = {
		Alpine: alpine_default,
		effect: effect3,
		cleanup,
		evaluateLater: evaluateLater.bind(evaluateLater, el),
		evaluate: evaluate$1.bind(evaluate$1, el)
	};
	let doCleanup = () => cleanups.forEach((i) => i());
	return [utilities, doCleanup];
}
function getDirectiveHandler(el, directive2) {
	let noop = () => {};
	let handler4 = directiveHandlers[directive2.type] || noop;
	let [utilities, cleanup] = getElementBoundUtilities(el);
	onAttributeRemoved(el, directive2.original, cleanup);
	let fullHandler = () => {
		if (el._x_ignore || el._x_ignoreSelf) return;
		handler4.inline && handler4.inline(el, directive2, utilities);
		handler4 = handler4.bind(handler4, el, directive2, utilities);
		isDeferringHandlers ? directiveHandlerStacks.get(currentHandlerStackKey).push(handler4) : handler4();
	};
	fullHandler.runCleanups = cleanup;
	return fullHandler;
}
var startingWith = (subject, replacement) => ({ name, value }) => {
	if (name.startsWith(subject)) name = name.replace(subject, replacement);
	return {
		name,
		value
	};
};
var into = (i) => i;
function toTransformedAttributes(callback = () => {}) {
	return ({ name, value }) => {
		let { name: newName, value: newValue } = attributeTransformers.reduce((carry, transform) => {
			return transform(carry);
		}, {
			name,
			value
		});
		if (newName !== name) callback(newName, name);
		return {
			name: newName,
			value: newValue
		};
	};
}
var attributeTransformers = [];
function mapAttributes(callback) {
	attributeTransformers.push(callback);
}
function outNonAlpineAttributes({ name }) {
	return alpineAttributeRegex().test(name);
}
var alpineAttributeRegex = () => new RegExp(`^${prefixAsString}([^:^.]+)\\b`);
function toParsedDirectives(transformedAttributeMap, originalAttributeOverride) {
	return ({ name, value }) => {
		if (name === value) value = "";
		let typeMatch = name.match(alpineAttributeRegex());
		let valueMatch = name.match(/:([a-zA-Z0-9\-_:]+)/);
		let modifiers = name.match(/\.[^.\]]+(?=[^\]]*$)/g) || [];
		let original = originalAttributeOverride || transformedAttributeMap[name] || name;
		return {
			type: typeMatch ? typeMatch[1] : null,
			value: valueMatch ? valueMatch[1] : null,
			modifiers: modifiers.map((i) => i.replace(".", "")),
			expression: value,
			original
		};
	};
}
var DEFAULT = "DEFAULT";
var directiveOrder = [
	"ignore",
	"ref",
	"id",
	"data",
	"anchor",
	"bind",
	"init",
	"for",
	"model",
	"modelable",
	"transition",
	"show",
	"if",
	DEFAULT,
	"teleport"
];
function byPriority(a, b) {
	let typeA = directiveOrder.indexOf(a.type) === -1 ? DEFAULT : a.type;
	let typeB = directiveOrder.indexOf(b.type) === -1 ? DEFAULT : b.type;
	return directiveOrder.indexOf(typeA) - directiveOrder.indexOf(typeB);
}
function walk(el, callback) {
	if (typeof ShadowRoot === "function" && el instanceof ShadowRoot) {
		Array.from(el.children).forEach((el2) => walk(el2, callback));
		return;
	}
	let skip = false;
	callback(el, () => skip = true);
	if (skip) return;
	let node = el.firstElementChild;
	while (node) {
		walk(node, callback, false);
		node = node.nextElementSibling;
	}
}
var isCloning = false;
function skipDuringClone(callback, fallback = () => {}) {
	return (...args) => isCloning ? fallback(...args) : callback(...args);
}
function onlyDuringClone(callback) {
	return (...args) => isCloning && callback(...args);
}
var interceptors = [];
function interceptClone(callback) {
	interceptors.push(callback);
}
function cloneNode(from, to) {
	interceptors.forEach((i) => i(from, to));
	isCloning = true;
	dontRegisterReactiveSideEffects(() => {
		initTree(to, (el, callback) => {
			callback(el, () => {});
		});
	});
	isCloning = false;
}
var isCloningLegacy = false;
function clone(oldEl, newEl) {
	if (!newEl._x_dataStack) newEl._x_dataStack = oldEl._x_dataStack;
	isCloning = true;
	isCloningLegacy = true;
	dontRegisterReactiveSideEffects(() => {
		cloneTree(newEl);
	});
	isCloning = false;
	isCloningLegacy = false;
}
function cloneTree(el) {
	let hasRunThroughFirstEl = false;
	let shallowWalker = (el2, callback) => {
		walk(el2, (el3, skip) => {
			if (hasRunThroughFirstEl && isRoot(el3)) return skip();
			hasRunThroughFirstEl = true;
			callback(el3, skip);
		});
	};
	initTree(el, shallowWalker);
}
function dontRegisterReactiveSideEffects(callback) {
	let cache = effect;
	overrideEffect((callback2, el) => {
		let storedEffect = cache(callback2);
		release(storedEffect);
		return () => {};
	});
	callback();
	overrideEffect(cache);
}
var activeDefers = 0;
function deferInit(el, promise) {
	let record = el._x_deferInit;
	if (!record) {
		record = el._x_deferInit = {
			pending: 0,
			ownsIgnore: !el._x_ignore,
			queuedAttributes: /* @__PURE__ */ new Map()
		};
		if (record.ownsIgnore) el._x_ignore = true;
		activeDefers++;
	}
	record.pending++;
	Promise.resolve(promise).catch((error2) => {
		try {
			handleError(error2, el);
		} catch (error3) {
			setTimeout(() => {
				throw error3;
			}, 0);
		}
	}).then(() => settle(el, record));
}
function settle(el, record) {
	record.pending--;
	if (record.pending > 0) return;
	flushPendingMutations();
	if (record.pending > 0) return;
	if (el._x_deferInit !== record) return;
	delete el._x_deferInit;
	if (record.ownsIgnore) delete el._x_ignore;
	activeDefers--;
	if (!el.isConnected) return;
	replayQueuedAttributes(record);
	initTree(el);
}
function queueAttributesForDeferredTree(el, attrs) {
	if (activeDefers === 0) return false;
	let root = findClosest(el, (i) => i._x_deferInit);
	if (!root) return false;
	queueInto(root._x_deferInit, el, attrs.map(({ name }) => name));
	return true;
}
function queueInto(record, el, names) {
	let entry = record.queuedAttributes.get(el);
	if (!entry || entry.marker !== el._x_marker) {
		entry = {
			marker: el._x_marker,
			names: /* @__PURE__ */ new Set()
		};
		record.queuedAttributes.set(el, entry);
	}
	names.forEach((name) => entry.names.add(name));
}
function replayQueuedAttributes(record) {
	record.queuedAttributes.forEach((entry, el) => {
		if (!el.isConnected) return;
		if (!el._x_marker) return;
		if (el._x_marker !== entry.marker) return;
		let suspendedAncestor = findClosest(el, (i) => i._x_deferInit);
		if (suspendedAncestor) {
			queueInto(suspendedAncestor._x_deferInit, el, Array.from(entry.names));
			return;
		}
		let attrs = Array.from(entry.names).filter((name) => el.hasAttribute(name)).map((name) => ({
			name,
			value: el.getAttribute(name)
		}));
		if (attrs.length === 0) return;
		directives(el, attrs).forEach((handle) => handle());
	});
}
interceptClone((from, to) => {
	if (activeDefers === 0) return;
	if (!from || from.nodeType !== 1 || !to || to.nodeType !== 1) return;
	if (findClosest(from, (i) => i._x_deferInit)) to._x_ignore = true;
});
function dispatch(el, name, detail = {}, options = {}) {
	return el.dispatchEvent(new CustomEvent(name, {
		detail,
		bubbles: true,
		composed: true,
		cancelable: true,
		...options
	}));
}
function warn(message, ...args) {
	console.warn(`Alpine Warning: ${message}`, ...args);
}
var started = false;
function start() {
	if (started) warn("Alpine has already been initialized on this page. Calling Alpine.start() more than once can cause problems.");
	started = true;
	if (!document.body) warn("Unable to initialize. Trying to load Alpine before `<body>` is available. Did you forget to add `defer` in Alpine's `<script>` tag?");
	dispatch(document, "alpine:init");
	dispatch(document, "alpine:initializing");
	startObservingMutations();
	onElAdded((el) => initTree(el, walk));
	onElRemoved((el) => destroyTree(el));
	onAttributesAdded((el, attrs) => {
		if (queueAttributesForDeferredTree(el, attrs)) return;
		directives(el, attrs).forEach((handle) => handle());
	});
	let outNestedComponents = (el) => !closestRoot(el.parentElement, true);
	Array.from(document.querySelectorAll(allSelectors().join(","))).filter(outNestedComponents).forEach((el) => {
		initTree(el);
	});
	dispatch(document, "alpine:initialized");
	setTimeout(() => {
		warnAboutMissingPlugins();
	});
}
var rootSelectorCallbacks = [];
var initSelectorCallbacks = [];
function rootSelectors() {
	return rootSelectorCallbacks.map((fn) => fn());
}
function allSelectors() {
	return rootSelectorCallbacks.concat(initSelectorCallbacks).map((fn) => fn());
}
function addRootSelector(selectorCallback) {
	rootSelectorCallbacks.push(selectorCallback);
}
function addInitSelector(selectorCallback) {
	initSelectorCallbacks.push(selectorCallback);
}
function closestRoot(el, includeInitSelectors = false) {
	return findClosest(el, (element) => {
		if ((includeInitSelectors ? allSelectors() : rootSelectors()).some((selector) => element.matches(selector))) return true;
	});
}
function findClosest(el, callback) {
	if (!el) return;
	if (callback(el)) return el;
	if (el._x_teleportBack) return findClosest(el._x_teleportBack, callback);
	if (el.parentNode instanceof ShadowRoot) return findClosest(el.parentNode.host, callback);
	if (!el.parentElement) return;
	return findClosest(el.parentElement, callback);
}
function isRoot(el) {
	return rootSelectors().some((selector) => el.matches(selector));
}
var initInterceptors2 = [];
function interceptInit(callback) {
	initInterceptors2.push(callback);
}
var markerDispenser = 1;
function initTree(el, walker = walk, intercept = () => {}) {
	if (findClosest(el, (i) => i._x_ignore)) return;
	deferHandlingDirectives(() => {
		walker(el, (el2, skip) => {
			if (el2._x_marker) return;
			intercept(el2, skip);
			initInterceptors2.forEach((i) => i(el2, skip));
			directives(el2, el2.attributes).forEach((handle) => handle());
			if (!el2._x_ignore) el2._x_marker = markerDispenser++;
			el2._x_ignore && skip();
		});
	});
}
function destroyTree(root, walker = walk) {
	walker(root, (el) => {
		cleanupElement(el);
		cleanupAttributes(el);
		delete el._x_marker;
	});
}
function warnAboutMissingPlugins() {
	[
		[
			"ui",
			"dialog",
			["[x-dialog], [x-popover]"]
		],
		[
			"anchor",
			"anchor",
			["[x-anchor]"]
		],
		[
			"sort",
			"sort",
			["[x-sort]"]
		]
	].forEach(([plugin2, directive2, selectors]) => {
		if (directiveExists(directive2)) return;
		selectors.some((selector) => {
			if (document.querySelector(selector)) {
				warn(`found "${selector}", but missing ${plugin2} plugin`);
				return true;
			}
		});
	});
}
var tickStack = [];
var isHolding = false;
function nextTick(callback = () => {}) {
	queueMicrotask(() => {
		isHolding || setTimeout(() => {
			releaseNextTicks();
		});
	});
	return new Promise((res) => {
		tickStack.push(() => {
			callback();
			res();
		});
	});
}
function releaseNextTicks() {
	isHolding = false;
	while (tickStack.length) tickStack.shift()();
}
function holdNextTicks() {
	isHolding = true;
}
function setClasses(el, value) {
	if (Array.isArray(value)) return setClassesFromString(el, value.join(" "));
	else if (typeof value === "object" && value !== null) return setClassesFromObject(el, value);
	else if (typeof value === "function") return setClasses(el, value());
	return setClassesFromString(el, value);
}
function splitClasses(classString) {
	return classString.split(/\s/).filter(Boolean);
}
function setClassesFromString(el, classString) {
	let missingClasses = (classString2) => splitClasses(classString2).filter((i) => !el.classList.contains(i)).filter(Boolean);
	let addClassesAndReturnUndo = (classes) => {
		el.classList.add(...classes);
		return () => {
			el.classList.remove(...classes);
		};
	};
	classString = classString === true ? classString = "" : classString || "";
	return addClassesAndReturnUndo(missingClasses(classString));
}
function setClassesFromObject(el, classObject) {
	let forAdd = Object.entries(classObject).flatMap(([classString, bool]) => bool ? splitClasses(classString) : false).filter(Boolean);
	let forRemove = Object.entries(classObject).flatMap(([classString, bool]) => !bool ? splitClasses(classString) : false).filter(Boolean);
	let added = [];
	let removed = [];
	forRemove.forEach((i) => {
		if (el.classList.contains(i)) {
			el.classList.remove(i);
			removed.push(i);
		}
	});
	forAdd.forEach((i) => {
		if (!el.classList.contains(i)) {
			el.classList.add(i);
			added.push(i);
		}
	});
	return () => {
		removed.forEach((i) => el.classList.add(i));
		added.forEach((i) => el.classList.remove(i));
	};
}
function setStyles(el, value) {
	if (typeof value === "object" && value !== null) return setStylesFromObject(el, value);
	return setStylesFromString(el, value);
}
function setStylesFromObject(el, value) {
	let previousStyles = {};
	Object.entries(value).forEach(([key, value2]) => {
		previousStyles[key] = el.style[key];
		if (!key.startsWith("--")) key = kebabCase(key);
		el.style.setProperty(key, value2);
	});
	setTimeout(() => {
		if (el.style.length === 0) el.removeAttribute("style");
	});
	return () => {
		setStyles(el, previousStyles);
	};
}
function setStylesFromString(el, value) {
	let cache = el.getAttribute("style", value);
	el.setAttribute("style", value);
	return () => {
		el.setAttribute("style", cache || "");
	};
}
function kebabCase(subject) {
	return subject.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
function once(callback, fallback = () => {}) {
	let called = false;
	return function() {
		if (!called) {
			called = true;
			callback.apply(this, arguments);
		} else fallback.apply(this, arguments);
	};
}
directive("transition", (el, { value, modifiers, expression }, { evaluate: evaluate2 }) => {
	if (typeof expression === "function") expression = evaluate2(expression);
	if (expression === false) return;
	if (!expression || typeof expression === "boolean") registerTransitionsFromHelper(el, modifiers, value);
	else registerTransitionsFromClassString(el, expression, value);
});
function registerTransitionsFromClassString(el, classString, stage) {
	registerTransitionObject(el, setClasses, "");
	({
		"enter": (classes) => {
			el._x_transition.enter.during = classes;
		},
		"enter-start": (classes) => {
			el._x_transition.enter.start = classes;
		},
		"enter-end": (classes) => {
			el._x_transition.enter.end = classes;
		},
		"leave": (classes) => {
			el._x_transition.leave.during = classes;
		},
		"leave-start": (classes) => {
			el._x_transition.leave.start = classes;
		},
		"leave-end": (classes) => {
			el._x_transition.leave.end = classes;
		}
	})[stage](classString);
}
function registerTransitionsFromHelper(el, modifiers, stage) {
	registerTransitionObject(el, setStyles);
	let doesntSpecify = !modifiers.includes("in") && !modifiers.includes("out") && !stage;
	let transitioningIn = doesntSpecify || modifiers.includes("in") || ["enter"].includes(stage);
	let transitioningOut = doesntSpecify || modifiers.includes("out") || ["leave"].includes(stage);
	if (modifiers.includes("in") && !doesntSpecify) modifiers = modifiers.filter((i, index) => index < modifiers.indexOf("out"));
	if (modifiers.includes("out") && !doesntSpecify) modifiers = modifiers.filter((i, index) => index > modifiers.indexOf("out"));
	let wantsAll = !modifiers.includes("opacity") && !modifiers.includes("scale");
	let wantsOpacity = wantsAll || modifiers.includes("opacity");
	let wantsScale = wantsAll || modifiers.includes("scale");
	let opacityValue = wantsOpacity ? 0 : 1;
	let scaleValue = wantsScale ? modifierValue(modifiers, "scale", 95) / 100 : 1;
	let delay = modifierValue(modifiers, "delay", 0) / 1e3;
	let origin = modifierValue(modifiers, "origin", "center");
	let property = "opacity, transform";
	let durationIn = modifierValue(modifiers, "duration", 150) / 1e3;
	let durationOut = modifierValue(modifiers, "duration", 75) / 1e3;
	let easing = `cubic-bezier(0.4, 0.0, 0.2, 1)`;
	if (transitioningIn) {
		el._x_transition.enter.during = {
			transformOrigin: origin,
			transitionDelay: `${delay}s`,
			transitionProperty: property,
			transitionDuration: `${durationIn}s`,
			transitionTimingFunction: easing
		};
		el._x_transition.enter.start = {
			opacity: opacityValue,
			transform: `scale(${scaleValue})`
		};
		el._x_transition.enter.end = {
			opacity: 1,
			transform: `scale(1)`
		};
	}
	if (transitioningOut) {
		el._x_transition.leave.during = {
			transformOrigin: origin,
			transitionDelay: `${delay}s`,
			transitionProperty: property,
			transitionDuration: `${durationOut}s`,
			transitionTimingFunction: easing
		};
		el._x_transition.leave.start = {
			opacity: 1,
			transform: `scale(1)`
		};
		el._x_transition.leave.end = {
			opacity: opacityValue,
			transform: `scale(${scaleValue})`
		};
	}
}
function registerTransitionObject(el, setFunction, defaultValue = {}) {
	if (!el._x_transition) el._x_transition = {
		enter: {
			during: defaultValue,
			start: defaultValue,
			end: defaultValue
		},
		leave: {
			during: defaultValue,
			start: defaultValue,
			end: defaultValue
		},
		in(before = () => {}, after = () => {}) {
			transition(el, setFunction, {
				during: this.enter.during,
				start: this.enter.start,
				end: this.enter.end
			}, before, after);
		},
		out(before = () => {}, after = () => {}) {
			transition(el, setFunction, {
				during: this.leave.during,
				start: this.leave.start,
				end: this.leave.end
			}, before, after);
		}
	};
}
window.Element.prototype._x_toggleAndCascadeWithTransitions = function(el, value, show, hide) {
	const nextTick2 = document.visibilityState === "visible" ? requestAnimationFrame : setTimeout;
	let clickAwayCompatibleShow = () => nextTick2(show);
	if (value) {
		if (el._x_transition && (el._x_transition.enter || el._x_transition.leave)) el._x_transition.enter && (Object.entries(el._x_transition.enter.during).length || Object.entries(el._x_transition.enter.start).length || Object.entries(el._x_transition.enter.end).length) ? el._x_transition.in(show) : clickAwayCompatibleShow();
		else el._x_transition ? el._x_transition.in(show) : clickAwayCompatibleShow();
		return;
	}
	el._x_hidePromise = el._x_transition ? new Promise((resolve, reject) => {
		el._x_transition.out(() => {}, () => resolve(hide));
		el._x_transitioning && el._x_transitioning.beforeCancel(() => reject({ isFromCancelledTransition: true }));
	}) : Promise.resolve(hide);
	queueMicrotask(() => {
		let closest = closestHide(el);
		if (closest) {
			if (!closest._x_hideChildren) closest._x_hideChildren = [];
			closest._x_hideChildren.push(el);
		} else nextTick2(() => {
			let hideAfterChildren = (el2) => {
				let carry = Promise.all([el2._x_hidePromise, ...(el2._x_hideChildren || []).map(hideAfterChildren)]).then(([i]) => i?.());
				delete el2._x_hidePromise;
				delete el2._x_hideChildren;
				return carry;
			};
			hideAfterChildren(el).catch((e) => {
				if (!e.isFromCancelledTransition) throw e;
			});
		});
	});
};
function closestHide(el) {
	let parent = el.parentNode;
	if (!parent) return;
	return parent._x_hidePromise ? parent : closestHide(parent);
}
function transition(el, setFunction, { during, start: start2, end } = {}, before = () => {}, after = () => {}) {
	if (el._x_transitioning) el._x_transitioning.cancel();
	if (Object.keys(during).length === 0 && Object.keys(start2).length === 0 && Object.keys(end).length === 0) {
		before();
		after();
		return;
	}
	let undoStart, undoDuring, undoEnd;
	performTransition(el, {
		start() {
			undoStart = setFunction(el, start2);
		},
		during() {
			undoDuring = setFunction(el, during);
		},
		before,
		end() {
			undoStart();
			undoEnd = setFunction(el, end);
		},
		after,
		cleanup() {
			undoDuring();
			undoEnd();
		}
	});
}
function performTransition(el, stages) {
	let interrupted, reachedBefore, reachedEnd;
	let finish = once(() => {
		mutateDom(() => {
			interrupted = true;
			if (!reachedBefore) stages.before();
			if (!reachedEnd) {
				stages.end();
				releaseNextTicks();
			}
			stages.after();
			if (el.isConnected) stages.cleanup();
			delete el._x_transitioning;
		});
	});
	el._x_transitioning = {
		beforeCancels: [],
		beforeCancel(callback) {
			this.beforeCancels.push(callback);
		},
		cancel: once(function() {
			while (this.beforeCancels.length) this.beforeCancels.shift()();
			finish();
		}),
		finish
	};
	mutateDom(() => {
		stages.start();
		stages.during();
	});
	holdNextTicks();
	requestAnimationFrame(() => {
		if (interrupted) return;
		let duration = Number(getComputedStyle(el).transitionDuration.replace(/,.*/, "").replace("s", "")) * 1e3;
		let delay = Number(getComputedStyle(el).transitionDelay.replace(/,.*/, "").replace("s", "")) * 1e3;
		if (duration === 0) duration = Number(getComputedStyle(el).animationDuration.replace("s", "")) * 1e3;
		mutateDom(() => {
			stages.before();
		});
		reachedBefore = true;
		requestAnimationFrame(() => {
			if (interrupted) return;
			mutateDom(() => {
				stages.end();
			});
			releaseNextTicks();
			setTimeout(el._x_transitioning.finish, duration + delay);
			reachedEnd = true;
		});
	});
}
function modifierValue(modifiers, key, fallback) {
	if (modifiers.indexOf(key) === -1) return fallback;
	const rawValue = modifiers[modifiers.indexOf(key) + 1];
	if (!rawValue) return fallback;
	if (key === "scale") {
		if (isNaN(rawValue)) return fallback;
	}
	if (key === "duration" || key === "delay") {
		let match = rawValue.match(/([0-9]+)ms/);
		if (match) return match[1];
	}
	if (key === "origin") {
		if ([
			"top",
			"right",
			"left",
			"center",
			"bottom"
		].includes(modifiers[modifiers.indexOf(key) + 2])) return [rawValue, modifiers[modifiers.indexOf(key) + 2]].join(" ");
	}
	return rawValue;
}
function bind(el, name, value, modifiers = []) {
	if (!el._x_bindings) el._x_bindings = reactive({});
	el._x_bindings[name] = value;
	name = modifiers.includes("camel") ? camelCase(name) : name;
	switch (name) {
		case "value":
			bindInputValue(el, value);
			break;
		case "style":
			bindStyles(el, value);
			break;
		case "class":
			bindClasses(el, value);
			break;
		case "selected":
		case "checked":
			bindAttributeAndProperty(el, name, value);
			break;
		default:
			bindAttribute(el, name, value);
			break;
	}
}
function bindInputValue(el, value) {
	if (isRadio(el)) {
		if (el.attributes.value === void 0) el.value = value;
	} else if (isCheckbox(el)) if (Number.isInteger(value)) el.value = value;
	else if (!Array.isArray(value) && typeof value !== "boolean" && ![null, void 0].includes(value)) el.value = String(value);
	else if (Array.isArray(value)) el.checked = value.some((val) => checkedAttrLooseCompare(val, el.value));
	else el.checked = !!value;
	else if (el.tagName === "SELECT") updateSelect(el, value);
	else if (el.tagName === "OPTION") bindAttribute(el, "value", value);
	else {
		if (el.value === value && (typeof value !== "object" || value === null)) return;
		el.value = value === void 0 ? "" : value;
	}
}
function bindClasses(el, value) {
	if (el._x_undoAddedClasses) el._x_undoAddedClasses();
	el._x_undoAddedClasses = setClasses(el, value);
}
function bindStyles(el, value) {
	if (el._x_undoAddedStyles) el._x_undoAddedStyles();
	el._x_undoAddedStyles = setStyles(el, value);
}
function bindAttributeAndProperty(el, name, value) {
	bindAttribute(el, name, value);
	setPropertyIfChanged(el, name, value);
}
function bindAttribute(el, name, value) {
	if ([
		null,
		void 0,
		false
	].includes(value) && attributeShouldntBePreservedIfFalsy(name)) el.removeAttribute(name);
	else {
		if (isBooleanAttr(name)) value = name;
		if (isObjectAttr(value)) value = JSON.stringify(value);
		setIfChanged(el, name, value);
	}
}
function setIfChanged(el, attrName, value) {
	if (el.getAttribute(attrName) != value) el.setAttribute(attrName, value);
}
function setPropertyIfChanged(el, propName, value) {
	if (el[propName] !== value) el[propName] = value;
}
function updateSelect(el, value) {
	const arrayWrappedValue = [].concat(value).map((value2) => {
		return value2 + "";
	});
	Array.from(el.options).forEach((option) => {
		option.selected = arrayWrappedValue.includes(option.value);
	});
}
function camelCase(subject) {
	return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
}
function checkedAttrLooseCompare(valueA, valueB) {
	return valueA == valueB;
}
function safeParseBoolean(rawValue) {
	if ([
		1,
		"1",
		"true",
		"on",
		"yes",
		true
	].includes(rawValue)) return true;
	if ([
		0,
		"0",
		"false",
		"off",
		"no",
		false
	].includes(rawValue)) return false;
	return rawValue ? Boolean(rawValue) : null;
}
var booleanAttributes = /* @__PURE__ */ new Set([
	"allowfullscreen",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"controls",
	"default",
	"defer",
	"disabled",
	"formnovalidate",
	"inert",
	"ismap",
	"itemscope",
	"loop",
	"multiple",
	"muted",
	"nomodule",
	"novalidate",
	"open",
	"playsinline",
	"readonly",
	"required",
	"reversed",
	"selected",
	"shadowrootclonable",
	"shadowrootdelegatesfocus",
	"shadowrootserializable"
]);
function isBooleanAttr(attrName) {
	return booleanAttributes.has(attrName);
}
function attributeShouldntBePreservedIfFalsy(name) {
	return ![
		"aria-pressed",
		"aria-checked",
		"aria-expanded",
		"aria-selected"
	].includes(name);
}
function isObjectAttr(value) {
	return typeof value === "object" && value !== null;
}
function getBinding(el, name, fallback) {
	if (el._x_bindings && el._x_bindings[name] !== void 0) return el._x_bindings[name];
	return getAttributeBinding(el, name, fallback);
}
function extractProp(el, name, fallback, extract = true) {
	if (el._x_bindings && el._x_bindings[name] !== void 0) return el._x_bindings[name];
	if (el._x_inlineBindings && el._x_inlineBindings[name] !== void 0) {
		let binding = el._x_inlineBindings[name];
		binding.extract = extract;
		return dontAutoEvaluateFunctions(() => {
			return evaluate$1(el, binding.expression);
		});
	}
	return getAttributeBinding(el, name, fallback);
}
function getAttributeBinding(el, name, fallback) {
	let attr = el.getAttribute(name);
	if (attr === null) return typeof fallback === "function" ? fallback() : fallback;
	if (attr === "") return true;
	if (isBooleanAttr(name)) return !![name, "true"].includes(attr);
	return attr;
}
function isCheckbox(el) {
	return el.type === "checkbox" || el.localName === "ui-checkbox" || el.localName === "ui-switch";
}
function isRadio(el) {
	return el.type === "radio" || el.localName === "ui-radio";
}
function debounce(func, wait) {
	let timeout;
	return function() {
		const context = this, args = arguments;
		const later = function() {
			timeout = null;
			func.apply(context, args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	};
}
function throttle(func, limit) {
	let inThrottle;
	return function() {
		let context = this, args = arguments;
		if (!inThrottle) {
			func.apply(context, args);
			inThrottle = true;
			setTimeout(() => inThrottle = false, limit);
		}
	};
}
function entangle({ get: outerGet, set: outerSet }, { get: innerGet, set: innerSet }) {
	let firstRun = true;
	let outerHash;
	let reference = effect(() => {
		let outer = outerGet();
		let inner = innerGet();
		if (firstRun) {
			innerSet(cloneIfObject(outer));
			firstRun = false;
		} else {
			let outerHashLatest = JSON.stringify(outer);
			let innerHashLatest = JSON.stringify(inner);
			if (outerHashLatest !== outerHash) innerSet(cloneIfObject(outer));
			else if (outerHashLatest !== innerHashLatest) outerSet(cloneIfObject(inner));
		}
		outerHash = JSON.stringify(outerGet());
		JSON.stringify(innerGet());
	});
	return () => {
		dequeueJob(reference);
		release(reference);
	};
}
function cloneIfObject(value) {
	return typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}
function plugin(callback) {
	(Array.isArray(callback) ? callback : [callback]).forEach((i) => i(alpine_default));
}
var stores = {};
var isReactive = false;
function store(name, value) {
	if (!isReactive) {
		stores = reactive(stores);
		isReactive = true;
	}
	if (value === void 0) return stores[name];
	stores[name] = value;
	if (typeof value === "object" && value !== null && value._x_interceptor) stores[name] = value.initialize(stores, name, name, () => {});
	else initInterceptors(stores[name]);
	if (typeof value === "object" && value !== null && value.hasOwnProperty("init") && typeof value.init === "function") stores[name].init();
}
function getStores() {
	return stores;
}
var binds = {};
function bind2(name, bindings) {
	let getBindings = typeof bindings !== "function" ? () => bindings : bindings;
	if (name instanceof Element) return applyBindingsObject(name, getBindings());
	else binds[name] = getBindings;
	return () => {};
}
function injectBindingProviders(obj) {
	Object.entries(binds).forEach(([name, callback]) => {
		Object.defineProperty(obj, name, { get() {
			return (...args) => {
				return callback(...args);
			};
		} });
	});
	return obj;
}
function applyBindingsObject(el, obj, original) {
	let cleanupRunners = [];
	while (cleanupRunners.length) cleanupRunners.pop()();
	let attributes = Object.entries(obj).map(([name, value]) => ({
		name,
		value
	}));
	let staticAttributes = attributesOnly(attributes);
	attributes = attributes.map((attribute) => {
		if (staticAttributes.find((attr) => attr.name === attribute.name)) return {
			name: `x-bind:${attribute.name}`,
			value: `"${attribute.value}"`
		};
		return attribute;
	});
	directives(el, attributes, original).map((handle) => {
		cleanupRunners.push(handle.runCleanups);
		handle();
	});
	return () => {
		while (cleanupRunners.length) cleanupRunners.pop()();
	};
}
var datas = {};
function data(name, callback) {
	datas[name] = callback;
}
function injectDataProviders(obj, context) {
	Object.entries(datas).forEach(([name, callback]) => {
		Object.defineProperty(obj, name, {
			get() {
				return (...args) => {
					return callback.bind(context)(...args);
				};
			},
			enumerable: false
		});
	});
	return obj;
}
var alpine_default = {
	get reactive() {
		return reactive;
	},
	get release() {
		return release;
	},
	get effect() {
		return effect;
	},
	get raw() {
		return raw$1;
	},
	get transaction() {
		return transaction;
	},
	version: "3.17.5",
	flushAndStopDeferringMutations,
	dontAutoEvaluateFunctions,
	disableEffectScheduling,
	startObservingMutations,
	stopObservingMutations,
	setReactivityEngine,
	onAttributeRemoved,
	onAttributesAdded,
	closestDataStack,
	skipDuringClone,
	onlyDuringClone,
	addRootSelector,
	addInitSelector,
	setErrorHandler,
	interceptClone,
	addScopeToNode,
	deferMutations,
	mapAttributes,
	evaluateLater,
	interceptInit,
	initInterceptors,
	injectMagics,
	setEvaluator,
	setRawEvaluator,
	mergeProxies,
	extractProp,
	findClosest,
	onElRemoved,
	closestRoot,
	destroyTree,
	interceptor,
	transition,
	setStyles,
	mutateDom,
	deferInit,
	directive,
	entangle,
	throttle,
	debounce,
	evaluate: evaluate$1,
	evaluateRaw,
	initTree,
	nextTick,
	prefixed: prefix,
	prefix: setPrefix,
	plugin,
	magic,
	store,
	start,
	clone,
	cloneNode,
	bound: getBinding,
	$data: scope,
	watch,
	walk,
	data,
	bind: bind2
};
function makeMap(str) {
	const map = /* @__PURE__ */ Object.create(null);
	for (const key of str.split(",")) map[key] = 1;
	return (val) => val in map;
}
Object.freeze({});
Object.freeze([]);
var extend = Object.assign;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var hasOwn = (val, key) => hasOwnProperty.call(val, key);
var isArray = Array.isArray;
var isMap = (val) => toTypeString(val) === "[object Map]";
var isString = (val) => typeof val === "string";
var isSymbol = (val) => typeof val === "symbol";
var isObject = (val) => val !== null && typeof val === "object";
var objectToString = Object.prototype.toString;
var toTypeString = (value) => objectToString.call(value);
var toRawType = (value) => {
	return toTypeString(value).slice(8, -1);
};
var isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
var cacheStringFunction = (fn) => {
	const cache = /* @__PURE__ */ Object.create(null);
	return (str) => {
		return cache[str] || (cache[str] = fn(str));
	};
};
var capitalize = cacheStringFunction((str) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
});
var hasChanged = (value, oldValue) => !Object.is(value, oldValue);
function warn2(msg, ...args) {
	console.warn(`[Vue warn] ${msg}`, ...args);
}
var activeEffectScope;
var activeSub;
var pausedQueueEffects = /* @__PURE__ */ new WeakSet();
var ReactiveEffect = class {
	constructor(fn) {
		this.fn = fn;
		this.deps = void 0;
		this.depsTail = void 0;
		this.flags = 5;
		this.next = void 0;
		this.cleanup = void 0;
		this.scheduler = void 0;
		if (activeEffectScope) if (activeEffectScope.active) activeEffectScope.effects.push(this);
		else this.flags &= -2;
	}
	pause() {
		this.flags |= 64;
	}
	resume() {
		if (this.flags & 64) {
			this.flags &= -65;
			if (pausedQueueEffects.has(this)) {
				pausedQueueEffects.delete(this);
				this.trigger();
			}
		}
	}
	/**
	* @internal
	*/
	notify() {
		if (this.flags & 2 && !(this.flags & 32)) return;
		if (!(this.flags & 8)) batch(this);
	}
	run() {
		if (!(this.flags & 1)) return this.fn();
		this.flags |= 2;
		cleanupEffect(this);
		prepareDeps(this);
		const prevEffect = activeSub;
		const prevShouldTrack = shouldTrack;
		activeSub = this;
		shouldTrack = true;
		try {
			return this.fn();
		} finally {
			if (activeSub !== this) warn2("Active effect was not restored correctly - this is likely a Vue internal bug.");
			cleanupDeps(this);
			activeSub = prevEffect;
			shouldTrack = prevShouldTrack;
			this.flags &= -3;
		}
	}
	stop() {
		if (this.flags & 1) {
			for (let link = this.deps; link; link = link.nextDep) removeSub(link);
			this.deps = this.depsTail = void 0;
			cleanupEffect(this);
			this.onStop && this.onStop();
			this.flags &= -2;
		}
	}
	trigger() {
		if (this.flags & 64) pausedQueueEffects.add(this);
		else if (this.scheduler) this.scheduler();
		else this.runIfDirty();
	}
	/**
	* @internal
	*/
	runIfDirty() {
		if (isDirty(this)) this.run();
	}
	get dirty() {
		return isDirty(this);
	}
};
var batchDepth = 0;
var batchedSub;
var batchedComputed;
function batch(sub, isComputed = false) {
	sub.flags |= 8;
	if (isComputed) {
		sub.next = batchedComputed;
		batchedComputed = sub;
		return;
	}
	sub.next = batchedSub;
	batchedSub = sub;
}
function startBatch() {
	batchDepth++;
}
function endBatch() {
	if (--batchDepth > 0) return;
	if (batchedComputed) {
		let e = batchedComputed;
		batchedComputed = void 0;
		while (e) {
			const next = e.next;
			e.next = void 0;
			e.flags &= -9;
			e = next;
		}
	}
	let error2;
	while (batchedSub) {
		let e = batchedSub;
		batchedSub = void 0;
		while (e) {
			const next = e.next;
			e.next = void 0;
			e.flags &= -9;
			if (e.flags & 1) try {
				e.trigger();
			} catch (err) {
				if (!error2) error2 = err;
			}
			e = next;
		}
	}
	if (error2) throw error2;
}
function prepareDeps(sub) {
	for (let link = sub.deps; link; link = link.nextDep) {
		link.version = -1;
		link.prevActiveLink = link.dep.activeLink;
		link.dep.activeLink = link;
	}
}
function cleanupDeps(sub) {
	let head;
	let tail = sub.depsTail;
	let link = tail;
	while (link) {
		const prev = link.prevDep;
		if (link.version === -1) {
			if (link === tail) tail = prev;
			removeSub(link);
			removeDep(link);
		} else head = link;
		link.dep.activeLink = link.prevActiveLink;
		link.prevActiveLink = void 0;
		link = prev;
	}
	sub.deps = head;
	sub.depsTail = tail;
}
function isDirty(sub) {
	for (let link = sub.deps; link; link = link.nextDep) if (link.dep.version !== link.version || link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version)) return true;
	if (sub._dirty) return true;
	return false;
}
function refreshComputed(computed) {
	if (computed.flags & 4 && !(computed.flags & 16)) return;
	computed.flags &= -17;
	if (computed.globalVersion === globalVersion) return;
	computed.globalVersion = globalVersion;
	if (!computed.isSSR && computed.flags & 128 && (!computed.deps && !computed._dirty || !isDirty(computed))) return;
	computed.flags |= 2;
	const dep = computed.dep;
	const prevSub = activeSub;
	const prevShouldTrack = shouldTrack;
	activeSub = computed;
	shouldTrack = true;
	try {
		prepareDeps(computed);
		const value = computed.fn(computed._value);
		if (dep.version === 0 || hasChanged(value, computed._value)) {
			computed.flags |= 128;
			computed._value = value;
			dep.version++;
		}
	} catch (err) {
		dep.version++;
		throw err;
	} finally {
		activeSub = prevSub;
		shouldTrack = prevShouldTrack;
		cleanupDeps(computed);
		computed.flags &= -3;
	}
}
function removeSub(link, soft = false) {
	const { dep, prevSub, nextSub } = link;
	if (prevSub) {
		prevSub.nextSub = nextSub;
		link.prevSub = void 0;
	}
	if (nextSub) {
		nextSub.prevSub = prevSub;
		link.nextSub = void 0;
	}
	if (dep.subsHead === link) dep.subsHead = nextSub;
	if (dep.subs === link) {
		dep.subs = prevSub;
		if (!prevSub && dep.computed) {
			dep.computed.flags &= -5;
			for (let l = dep.computed.deps; l; l = l.nextDep) removeSub(l, true);
		}
	}
	if (!soft && !--dep.sc && dep.map) dep.map.delete(dep.key);
}
function removeDep(link) {
	const { prevDep, nextDep } = link;
	if (prevDep) {
		prevDep.nextDep = nextDep;
		link.prevDep = void 0;
	}
	if (nextDep) {
		nextDep.prevDep = prevDep;
		link.nextDep = void 0;
	}
}
function effect2(fn, options) {
	if (fn.effect instanceof ReactiveEffect) fn = fn.effect.fn;
	const e = new ReactiveEffect(fn);
	if (options) extend(e, options);
	try {
		e.run();
	} catch (err) {
		e.stop();
		throw err;
	}
	const runner = e.run.bind(e);
	runner.effect = e;
	return runner;
}
function stop(runner) {
	runner.effect.stop();
}
var shouldTrack = true;
var trackStack = [];
function pauseTracking() {
	trackStack.push(shouldTrack);
	shouldTrack = false;
}
function resetTracking() {
	const last = trackStack.pop();
	shouldTrack = last === void 0 ? true : last;
}
function cleanupEffect(e) {
	const { cleanup } = e;
	e.cleanup = void 0;
	if (cleanup) {
		const prevSub = activeSub;
		activeSub = void 0;
		try {
			cleanup();
		} finally {
			activeSub = prevSub;
		}
	}
}
var globalVersion = 0;
var Link = class {
	constructor(sub, dep) {
		this.sub = sub;
		this.dep = dep;
		this.version = dep.version;
		this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
	}
};
var Dep = class {
	constructor(computed) {
		this.computed = computed;
		this.version = 0;
		this.activeLink = void 0;
		this.subs = void 0;
		this.map = void 0;
		this.key = void 0;
		this.sc = 0;
		this.__v_skip = true;
		this.subsHead = void 0;
	}
	track(debugInfo) {
		if (!activeSub || !shouldTrack || activeSub === this.computed) return;
		let link = this.activeLink;
		if (link === void 0 || link.sub !== activeSub) {
			link = this.activeLink = new Link(activeSub, this);
			if (!activeSub.deps) activeSub.deps = activeSub.depsTail = link;
			else {
				link.prevDep = activeSub.depsTail;
				activeSub.depsTail.nextDep = link;
				activeSub.depsTail = link;
			}
			addSub(link);
		} else if (link.version === -1) {
			link.version = this.version;
			if (link.nextDep) {
				const next = link.nextDep;
				next.prevDep = link.prevDep;
				if (link.prevDep) link.prevDep.nextDep = next;
				link.prevDep = activeSub.depsTail;
				link.nextDep = void 0;
				activeSub.depsTail.nextDep = link;
				activeSub.depsTail = link;
				if (activeSub.deps === link) activeSub.deps = next;
			}
		}
		if (activeSub.onTrack) activeSub.onTrack(extend({ effect: activeSub }, debugInfo));
		return link;
	}
	trigger(debugInfo) {
		this.version++;
		globalVersion++;
		this.notify(debugInfo);
	}
	notify(debugInfo) {
		startBatch();
		try {
			for (let head = this.subsHead; head; head = head.nextSub) if (head.sub.onTrigger && !(head.sub.flags & 8)) head.sub.onTrigger(extend({ effect: head.sub }, debugInfo));
			for (let link = this.subs; link; link = link.prevSub) if (link.sub.notify()) link.sub.dep.notify();
		} finally {
			endBatch();
		}
	}
};
function addSub(link) {
	link.dep.sc++;
	if (link.sub.flags & 4) {
		const computed = link.dep.computed;
		if (computed && !link.dep.subs) {
			computed.flags |= 20;
			for (let l = computed.deps; l; l = l.nextDep) addSub(l);
		}
		const currentTail = link.dep.subs;
		if (currentTail !== link) {
			link.prevSub = currentTail;
			if (currentTail) currentTail.nextSub = link;
		}
		if (link.dep.subsHead === void 0) link.dep.subsHead = link;
		link.dep.subs = link;
	}
}
var targetMap = /* @__PURE__ */ new WeakMap();
var ITERATE_KEY = /* @__PURE__ */ Symbol("Object iterate");
var MAP_KEY_ITERATE_KEY = /* @__PURE__ */ Symbol("Map keys iterate");
var ARRAY_ITERATE_KEY = /* @__PURE__ */ Symbol("Array iterate");
function track(target, type, key) {
	if (shouldTrack && activeSub) {
		let depsMap = targetMap.get(target);
		if (!depsMap) targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
		let dep = depsMap.get(key);
		if (!dep) {
			depsMap.set(key, dep = new Dep());
			dep.map = depsMap;
			dep.key = key;
		}
		dep.track({
			target,
			type,
			key
		});
	}
}
function trigger(target, type, key, newValue, oldValue, oldTarget) {
	const depsMap = targetMap.get(target);
	if (!depsMap) {
		globalVersion++;
		return;
	}
	const run = (dep) => {
		if (dep) dep.trigger({
			target,
			type,
			key,
			newValue,
			oldValue,
			oldTarget
		});
	};
	startBatch();
	if (type === "clear") depsMap.forEach(run);
	else {
		const targetIsArray = isArray(target);
		const isArrayIndex = targetIsArray && isIntegerKey(key);
		if (targetIsArray && key === "length") {
			const newLength = Number(newValue);
			depsMap.forEach((dep, key2) => {
				if (key2 === "length" || key2 === ARRAY_ITERATE_KEY || !isSymbol(key2) && key2 >= newLength) run(dep);
			});
		} else {
			if (key !== void 0 || depsMap.has(void 0)) run(depsMap.get(key));
			if (isArrayIndex) run(depsMap.get(ARRAY_ITERATE_KEY));
			switch (type) {
				case "add":
					if (!targetIsArray) {
						run(depsMap.get(ITERATE_KEY));
						if (isMap(target)) run(depsMap.get(MAP_KEY_ITERATE_KEY));
					} else if (isArrayIndex) run(depsMap.get("length"));
					break;
				case "delete":
					if (!targetIsArray) {
						run(depsMap.get(ITERATE_KEY));
						if (isMap(target)) run(depsMap.get(MAP_KEY_ITERATE_KEY));
					}
					break;
				case "set":
					if (isMap(target)) run(depsMap.get(ITERATE_KEY));
					break;
			}
		}
	}
	endBatch();
}
function reactiveReadArray(array) {
	const raw2 = toRaw(array);
	if (raw2 === array) return raw2;
	track(raw2, "iterate", ARRAY_ITERATE_KEY);
	return isShallow(array) ? raw2 : raw2.map(toReactive);
}
function shallowReadArray(arr) {
	track(arr = toRaw(arr), "iterate", ARRAY_ITERATE_KEY);
	return arr;
}
function toWrapped(target, item) {
	if (isReadonly(target)) return isReactive2(target) ? toReadonly(toReactive(item)) : toReadonly(item);
	return toReactive(item);
}
var arrayInstrumentations = {
	__proto__: null,
	[Symbol.iterator]() {
		return iterator(this, Symbol.iterator, (item) => toWrapped(this, item));
	},
	concat(...args) {
		return reactiveReadArray(this).concat(...args.map((x) => isArray(x) ? reactiveReadArray(x) : x));
	},
	entries() {
		return iterator(this, "entries", (value) => {
			value[1] = toWrapped(this, value[1]);
			return value;
		});
	},
	every(fn, thisArg) {
		return apply(this, "every", fn, thisArg, void 0, arguments);
	},
	filter(fn, thisArg) {
		return apply(this, "filter", fn, thisArg, (v) => v.map((item) => toWrapped(this, item)), arguments);
	},
	find(fn, thisArg) {
		return apply(this, "find", fn, thisArg, (item) => toWrapped(this, item), arguments);
	},
	findIndex(fn, thisArg) {
		return apply(this, "findIndex", fn, thisArg, void 0, arguments);
	},
	findLast(fn, thisArg) {
		return apply(this, "findLast", fn, thisArg, (item) => toWrapped(this, item), arguments);
	},
	findLastIndex(fn, thisArg) {
		return apply(this, "findLastIndex", fn, thisArg, void 0, arguments);
	},
	forEach(fn, thisArg) {
		return apply(this, "forEach", fn, thisArg, void 0, arguments);
	},
	includes(...args) {
		return searchProxy(this, "includes", args);
	},
	indexOf(...args) {
		return searchProxy(this, "indexOf", args);
	},
	join(separator) {
		return reactiveReadArray(this).join(separator);
	},
	lastIndexOf(...args) {
		return searchProxy(this, "lastIndexOf", args);
	},
	map(fn, thisArg) {
		return apply(this, "map", fn, thisArg, void 0, arguments);
	},
	pop() {
		return noTracking(this, "pop");
	},
	push(...args) {
		return noTracking(this, "push", args);
	},
	reduce(fn, ...args) {
		return reduce(this, "reduce", fn, args);
	},
	reduceRight(fn, ...args) {
		return reduce(this, "reduceRight", fn, args);
	},
	shift() {
		return noTracking(this, "shift");
	},
	some(fn, thisArg) {
		return apply(this, "some", fn, thisArg, void 0, arguments);
	},
	splice(...args) {
		return noTracking(this, "splice", args);
	},
	toReversed() {
		return reactiveReadArray(this).toReversed();
	},
	toSorted(comparer) {
		return reactiveReadArray(this).toSorted(comparer);
	},
	toSpliced(...args) {
		return reactiveReadArray(this).toSpliced(...args);
	},
	unshift(...args) {
		return noTracking(this, "unshift", args);
	},
	values() {
		return iterator(this, "values", (item) => toWrapped(this, item));
	}
};
function iterator(self2, method, wrapValue) {
	const arr = shallowReadArray(self2);
	const iter = arr[method]();
	if (arr !== self2 && !isShallow(self2)) {
		iter._next = iter.next;
		iter.next = () => {
			const result = iter._next();
			if (!result.done) result.value = wrapValue(result.value);
			return result;
		};
	}
	return iter;
}
var arrayProto = Array.prototype;
function apply(self2, method, fn, thisArg, wrappedRetFn, args) {
	const arr = shallowReadArray(self2);
	const needsWrap = arr !== self2 && !isShallow(self2);
	const methodFn = arr[method];
	if (methodFn !== arrayProto[method]) {
		const result2 = methodFn.apply(self2, args);
		return needsWrap ? toReactive(result2) : result2;
	}
	let wrappedFn = fn;
	if (arr !== self2) {
		if (needsWrap) wrappedFn = function(item, index) {
			return fn.call(this, toWrapped(self2, item), index, self2);
		};
		else if (fn.length > 2) wrappedFn = function(item, index) {
			return fn.call(this, item, index, self2);
		};
	}
	const result = methodFn.call(arr, wrappedFn, thisArg);
	return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result;
}
function reduce(self2, method, fn, args) {
	const arr = shallowReadArray(self2);
	const needsWrap = arr !== self2 && !isShallow(self2);
	let wrappedFn = fn;
	let wrapInitialAccumulator = false;
	if (arr !== self2) {
		if (needsWrap) {
			wrapInitialAccumulator = args.length === 0;
			wrappedFn = function(acc, item, index) {
				if (wrapInitialAccumulator) {
					wrapInitialAccumulator = false;
					acc = toWrapped(self2, acc);
				}
				return fn.call(this, acc, toWrapped(self2, item), index, self2);
			};
		} else if (fn.length > 3) wrappedFn = function(acc, item, index) {
			return fn.call(this, acc, item, index, self2);
		};
	}
	const result = arr[method](wrappedFn, ...args);
	return wrapInitialAccumulator ? toWrapped(self2, result) : result;
}
function searchProxy(self2, method, args) {
	const arr = toRaw(self2);
	track(arr, "iterate", ARRAY_ITERATE_KEY);
	const res = arr[method](...args);
	if ((res === -1 || res === false) && isProxy(args[0])) {
		args[0] = toRaw(args[0]);
		return arr[method](...args);
	}
	return res;
}
function noTracking(self2, method, args = []) {
	pauseTracking();
	startBatch();
	const res = toRaw(self2)[method].apply(self2, args);
	endBatch();
	resetTracking();
	return res;
}
var isNonTrackableKeys = /* @__PURE__ */ makeMap(`__proto__,__v_isRef,__isVue`);
var builtInSymbols = new Set(/* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((key) => key !== "arguments" && key !== "caller").map((key) => Symbol[key]).filter(isSymbol));
function hasOwnProperty2(key) {
	if (!isSymbol(key)) key = String(key);
	const obj = toRaw(this);
	track(obj, "has", key);
	return obj.hasOwnProperty(key);
}
var BaseReactiveHandler = class {
	constructor(_isReadonly = false, _isShallow = false) {
		this._isReadonly = _isReadonly;
		this._isShallow = _isShallow;
	}
	get(target, key, receiver) {
		if (key === "__v_skip") return target["__v_skip"];
		const isReadonly2 = this._isReadonly, isShallow2 = this._isShallow;
		if (key === "__v_isReactive") return !isReadonly2;
		else if (key === "__v_isReadonly") return isReadonly2;
		else if (key === "__v_isShallow") return isShallow2;
		else if (key === "__v_raw") {
			if (receiver === (isReadonly2 ? isShallow2 ? shallowReadonlyMap : readonlyMap : isShallow2 ? shallowReactiveMap : reactiveMap).get(target) || Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)) return target;
			return;
		}
		const targetIsArray = isArray(target);
		if (!isReadonly2) {
			let fn;
			if (targetIsArray && (fn = arrayInstrumentations[key])) return fn;
			if (key === "hasOwnProperty") return hasOwnProperty2;
		}
		const res = Reflect.get(target, key, isRef(target) ? target : receiver);
		if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) return res;
		if (!isReadonly2) track(target, "get", key);
		if (isShallow2) return res;
		if (isRef(res)) {
			const value = targetIsArray && isIntegerKey(key) ? res : res.value;
			return isReadonly2 && isObject(value) ? readonly(value) : value;
		}
		if (isObject(res)) return isReadonly2 ? readonly(res) : reactive2(res);
		return res;
	}
};
var MutableReactiveHandler = class extends BaseReactiveHandler {
	constructor(isShallow2 = false) {
		super(false, isShallow2);
	}
	set(target, key, value, receiver) {
		let oldValue = target[key];
		const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key);
		if (!this._isShallow) {
			const isOldValueReadonly = isReadonly(oldValue);
			if (!isShallow(value) && !isReadonly(value)) {
				oldValue = toRaw(oldValue);
				value = toRaw(value);
			}
			if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) if (isOldValueReadonly) {
				warn2(`Set operation on key "${String(key)}" failed: target is readonly.`, target[key]);
				return true;
			} else {
				oldValue.value = value;
				return true;
			}
		}
		const hadKey = isArrayWithIntegerKey ? Number(key) < target.length : hasOwn(target, key);
		const result = Reflect.set(target, key, value, isRef(target) ? target : receiver);
		if (target === toRaw(receiver) && result) {
			if (!hadKey) trigger(target, "add", key, value);
			else if (hasChanged(value, oldValue)) trigger(target, "set", key, value, oldValue);
		}
		return result;
	}
	deleteProperty(target, key) {
		const hadKey = hasOwn(target, key);
		const oldValue = target[key];
		const result = Reflect.deleteProperty(target, key);
		if (result && hadKey) trigger(target, "delete", key, void 0, oldValue);
		return result;
	}
	has(target, key) {
		const result = Reflect.has(target, key);
		if (!isSymbol(key) || !builtInSymbols.has(key)) track(target, "has", key);
		return result;
	}
	ownKeys(target) {
		track(target, "iterate", isArray(target) ? "length" : ITERATE_KEY);
		return Reflect.ownKeys(target);
	}
};
var ReadonlyReactiveHandler = class extends BaseReactiveHandler {
	constructor(isShallow2 = false) {
		super(true, isShallow2);
	}
	set(target, key) {
		warn2(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
		return true;
	}
	deleteProperty(target, key) {
		warn2(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
		return true;
	}
};
var mutableHandlers = /* @__PURE__ */ new MutableReactiveHandler();
var readonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler();
var toShallow = (value) => value;
var getProto = (v) => Reflect.getPrototypeOf(v);
function createIterableMethod(method, isReadonly2, isShallow2) {
	return function(...args) {
		const target = this["__v_raw"];
		const rawTarget = toRaw(target);
		const targetIsMap = isMap(rawTarget);
		const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
		const isKeyOnly = method === "keys" && targetIsMap;
		const innerIterator = target[method](...args);
		const wrap = isShallow2 ? toShallow : isReadonly2 ? toReadonly : toReactive;
		!isReadonly2 && track(rawTarget, "iterate", isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY);
		return extend(Object.create(innerIterator), { next() {
			const { value, done } = innerIterator.next();
			return done ? {
				value,
				done
			} : {
				value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
				done
			};
		} });
	};
}
function createReadonlyMethod(type) {
	return function(...args) {
		{
			const key = args[0] ? `on key "${args[0]}" ` : ``;
			warn2(`${capitalize(type)} operation ${key}failed: target is readonly.`, toRaw(this));
		}
		return type === "delete" ? false : type === "clear" ? void 0 : this;
	};
}
function createInstrumentations(readonly2, shallow) {
	const instrumentations = {
		get(key) {
			const target = this["__v_raw"];
			const rawTarget = toRaw(target);
			const rawKey = toRaw(key);
			if (!readonly2) {
				if (hasChanged(key, rawKey)) track(rawTarget, "get", key);
				track(rawTarget, "get", rawKey);
			}
			const { has } = getProto(rawTarget);
			const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
			if (has.call(rawTarget, key)) return wrap(target.get(key));
			else if (has.call(rawTarget, rawKey)) return wrap(target.get(rawKey));
			else if (target !== rawTarget) target.get(key);
		},
		get size() {
			const target = this["__v_raw"];
			!readonly2 && track(toRaw(target), "iterate", ITERATE_KEY);
			return target.size;
		},
		has(key) {
			const target = this["__v_raw"];
			const rawTarget = toRaw(target);
			const rawKey = toRaw(key);
			if (!readonly2) {
				if (hasChanged(key, rawKey)) track(rawTarget, "has", key);
				track(rawTarget, "has", rawKey);
			}
			return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
		},
		forEach(callback, thisArg) {
			const observed = this;
			const target = observed["__v_raw"];
			const rawTarget = toRaw(target);
			const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
			!readonly2 && track(rawTarget, "iterate", ITERATE_KEY);
			return target.forEach((value, key) => {
				return callback.call(thisArg, wrap(value), wrap(key), observed);
			});
		}
	};
	extend(instrumentations, readonly2 ? {
		add: createReadonlyMethod("add"),
		set: createReadonlyMethod("set"),
		delete: createReadonlyMethod("delete"),
		clear: createReadonlyMethod("clear")
	} : {
		add(value) {
			const target = toRaw(this);
			const proto = getProto(target);
			const rawValue = toRaw(value);
			const valueToAdd = !shallow && !isShallow(value) && !isReadonly(value) ? rawValue : value;
			if (!(proto.has.call(target, valueToAdd) || hasChanged(value, valueToAdd) && proto.has.call(target, value) || hasChanged(rawValue, valueToAdd) && proto.has.call(target, rawValue))) {
				target.add(valueToAdd);
				trigger(target, "add", valueToAdd, valueToAdd);
			}
			return this;
		},
		set(key, value) {
			if (!shallow && !isShallow(value) && !isReadonly(value)) value = toRaw(value);
			const target = toRaw(this);
			const { has, get: get2 } = getProto(target);
			let hadKey = has.call(target, key);
			if (!hadKey) {
				key = toRaw(key);
				hadKey = has.call(target, key);
			} else checkIdentityKeys(target, has, key);
			const oldValue = get2.call(target, key);
			target.set(key, value);
			if (!hadKey) trigger(target, "add", key, value);
			else if (hasChanged(value, oldValue)) trigger(target, "set", key, value, oldValue);
			return this;
		},
		delete(key) {
			const target = toRaw(this);
			const { has, get: get2 } = getProto(target);
			let hadKey = has.call(target, key);
			if (!hadKey) {
				key = toRaw(key);
				hadKey = has.call(target, key);
			} else checkIdentityKeys(target, has, key);
			const oldValue = get2 ? get2.call(target, key) : void 0;
			const result = target.delete(key);
			if (hadKey) trigger(target, "delete", key, void 0, oldValue);
			return result;
		},
		clear() {
			const target = toRaw(this);
			const hadItems = target.size !== 0;
			const oldTarget = isMap(target) ? new Map(target) : new Set(target);
			const result = target.clear();
			if (hadItems) trigger(target, "clear", void 0, void 0, oldTarget);
			return result;
		}
	});
	[
		"keys",
		"values",
		"entries",
		Symbol.iterator
	].forEach((method) => {
		instrumentations[method] = createIterableMethod(method, readonly2, shallow);
	});
	return instrumentations;
}
function createInstrumentationGetter(isReadonly2, shallow) {
	const instrumentations = createInstrumentations(isReadonly2, shallow);
	return (target, key, receiver) => {
		if (key === "__v_isReactive") return !isReadonly2;
		else if (key === "__v_isReadonly") return isReadonly2;
		else if (key === "__v_raw") return target;
		return Reflect.get(hasOwn(instrumentations, key) && key in target ? instrumentations : target, key, receiver);
	};
}
var mutableCollectionHandlers = { get: /* @__PURE__ */ createInstrumentationGetter(false, false) };
var readonlyCollectionHandlers = { get: /* @__PURE__ */ createInstrumentationGetter(true, false) };
function checkIdentityKeys(target, has, key) {
	const rawKey = toRaw(key);
	if (rawKey !== key && has.call(target, rawKey)) {
		const type = toRawType(target);
		warn2(`Reactive ${type} contains both the raw and reactive versions of the same object${type === `Map` ? ` as keys` : ``}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`);
	}
}
var reactiveMap = /* @__PURE__ */ new WeakMap();
var shallowReactiveMap = /* @__PURE__ */ new WeakMap();
var readonlyMap = /* @__PURE__ */ new WeakMap();
var shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
function targetTypeMap(rawType) {
	switch (rawType) {
		case "Object":
		case "Array": return 1;
		case "Map":
		case "Set":
		case "WeakMap":
		case "WeakSet": return 2;
		default: return 0;
	}
}
function reactive2(target) {
	if (/* @__PURE__ */ isReadonly(target)) return target;
	return createReactiveObject(target, false, mutableHandlers, mutableCollectionHandlers, reactiveMap);
}
function readonly(target) {
	return createReactiveObject(target, true, readonlyHandlers, readonlyCollectionHandlers, readonlyMap);
}
function createReactiveObject(target, isReadonly2, baseHandlers, collectionHandlers, proxyMap) {
	if (!isObject(target)) {
		warn2(`value cannot be made ${isReadonly2 ? "readonly" : "reactive"}: ${String(target)}`);
		return target;
	}
	if (target["__v_raw"] && !(isReadonly2 && target["__v_isReactive"])) return target;
	if (target["__v_skip"] || !Object.isExtensible(target)) return target;
	const existingProxy = proxyMap.get(target);
	if (existingProxy) return existingProxy;
	const targetType = targetTypeMap(toRawType(target));
	if (targetType === 0) return target;
	const proxy = new Proxy(target, targetType === 2 ? collectionHandlers : baseHandlers);
	proxyMap.set(target, proxy);
	return proxy;
}
function isReactive2(value) {
	if (/* @__PURE__ */ isReadonly(value)) return /* @__PURE__ */ isReactive2(value["__v_raw"]);
	return !!(value && value["__v_isReactive"]);
}
function isReadonly(value) {
	return !!(value && value["__v_isReadonly"]);
}
function isShallow(value) {
	return !!(value && value["__v_isShallow"]);
}
function isProxy(value) {
	return value ? !!value["__v_raw"] : false;
}
function toRaw(observed) {
	const raw2 = observed && observed["__v_raw"];
	return raw2 ? /* @__PURE__ */ toRaw(raw2) : observed;
}
var toReactive = (value) => isObject(value) ? /* @__PURE__ */ reactive2(value) : value;
var toReadonly = (value) => isObject(value) ? /* @__PURE__ */ readonly(value) : value;
function isRef(r) {
	return r ? r["__v_isRef"] === true : false;
}
magic("nextTick", () => nextTick);
magic("dispatch", (el) => dispatch.bind(dispatch, el));
magic("watch", (el, { evaluateLater: evaluateLater2, cleanup }) => (key, callback) => {
	let evaluate2 = evaluateLater2(key);
	let getter = () => {
		let value;
		evaluate2((i) => value = i);
		return value;
	};
	cleanup(watch(getter, callback));
});
magic("store", getStores);
magic("data", (el) => scope(el));
magic("root", (el) => closestRoot(el));
magic("refs", (el) => {
	if (el._x_refs_proxy) return el._x_refs_proxy;
	el._x_refs_proxy = mergeProxies(getArrayOfRefObject(el));
	return el._x_refs_proxy;
});
function getArrayOfRefObject(el) {
	let refObjects = [];
	findClosest(el, (i) => {
		if (i._x_refs) refObjects.push(i._x_refs);
	});
	return refObjects;
}
var globalIdMemo = {};
function findAndIncrementId(name) {
	if (!globalIdMemo[name]) globalIdMemo[name] = 0;
	return ++globalIdMemo[name];
}
function closestIdRoot(el, name) {
	return findClosest(el, (element) => {
		if (element._x_ids && element._x_ids[name]) return true;
	});
}
function setIdRoot(el, name) {
	if (!el._x_ids) el._x_ids = {};
	if (!el._x_ids[name]) el._x_ids[name] = findAndIncrementId(name);
}
magic("id", (el, { cleanup }) => (name, key = null) => {
	return cacheIdByNameOnElement(el, `${name}${key ? `-${key}` : ""}`, cleanup, () => {
		let root = closestIdRoot(el, name);
		let id = root ? root._x_ids[name] : findAndIncrementId(name);
		return key ? `${name}-${id}-${key}` : `${name}-${id}`;
	});
});
interceptClone((from, to) => {
	if (from._x_id) to._x_id = from._x_id;
});
function cacheIdByNameOnElement(el, cacheKey, cleanup, callback) {
	if (!el._x_id) el._x_id = {};
	if (el._x_id[cacheKey]) return el._x_id[cacheKey];
	let output = callback();
	el._x_id[cacheKey] = output;
	cleanup(() => {
		delete el._x_id[cacheKey];
	});
	return output;
}
magic("el", (el) => el);
warnMissingPluginMagic("Focus", "focus", "focus");
warnMissingPluginMagic("Persist", "persist", "persist");
function warnMissingPluginMagic(name, magicName, slug) {
	magic(magicName, (el) => warn(`You can't use [$${magicName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
}
directive("modelable", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2, cleanup }) => {
	let func = evaluateLater2(expression);
	let innerGet = () => {
		let result;
		func((i) => result = i);
		return result;
	};
	let evaluateInnerSet = evaluateLater2(`${expression} = __placeholder`);
	let innerSet = (val) => evaluateInnerSet(() => {}, { scope: { "__placeholder": val } });
	innerSet(innerGet());
	queueMicrotask(() => {
		if (!el._x_model) return;
		el._x_removeModelListeners["default"]();
		let outerGet = el._x_model.get;
		let outerSet = el._x_model.setWithModifiers;
		cleanup(entangle({
			get() {
				return outerGet();
			},
			set(value) {
				outerSet(value);
			}
		}, {
			get() {
				return innerGet();
			},
			set(value) {
				innerSet(value);
			}
		}));
	});
});
directive("teleport", (el, { modifiers, expression }, { cleanup }) => {
	if (el.tagName.toLowerCase() !== "template") warn("x-teleport can only be used on a <template> tag", el);
	let target = getTarget(expression);
	let clone2 = el.content.cloneNode(true).firstElementChild;
	el._x_teleport = clone2;
	clone2._x_teleportBack = el;
	el.setAttribute("data-teleport-template", true);
	clone2.setAttribute("data-teleport-target", true);
	if (el._x_forwardEvents) el._x_forwardEvents.forEach((eventName) => {
		clone2.addEventListener(eventName, (e) => {
			e.stopPropagation();
			el.dispatchEvent(new e.constructor(e.type, e));
		});
	});
	addScopeToNode(clone2, {}, el);
	let placeInDom = (clone3, target2, modifiers2) => {
		if (modifiers2.includes("prepend")) target2.parentNode.insertBefore(clone3, target2);
		else if (modifiers2.includes("append")) target2.parentNode.insertBefore(clone3, target2.nextSibling);
		else target2.appendChild(clone3);
	};
	mutateDom(() => {
		skipDuringClone(() => {
			placeInDom(clone2, target, modifiers);
			initTree(clone2);
		})();
	});
	el._x_teleportPutBack = () => {
		let target2 = getTarget(expression);
		mutateDom(() => {
			placeInDom(el._x_teleport, target2, modifiers);
		});
	};
	cleanup(() => mutateDom(() => {
		clone2.remove();
		destroyTree(clone2);
	}));
});
var teleportContainerDuringClone = document.createElement("div");
function getTarget(expression) {
	let target = skipDuringClone(() => {
		return document.querySelector(expression);
	}, () => {
		return teleportContainerDuringClone;
	})();
	if (!target) warn(`Cannot find x-teleport element for selector: "${expression}"`);
	return target;
}
var handler = () => {};
handler.inline = (el, { modifiers }, { cleanup }) => {
	modifiers.includes("self") ? el._x_ignoreSelf = true : el._x_ignore = true;
	cleanup(() => {
		modifiers.includes("self") ? delete el._x_ignoreSelf : delete el._x_ignore;
	});
};
directive("ignore", handler);
directive("effect", skipDuringClone((el, { expression }, { effect: effect3 }) => {
	effect3(evaluateLater(el, expression));
}));
function on(el, event, modifiers, callback) {
	let listenerTarget = el;
	let handler4 = (e) => callback(e);
	let options = {};
	let wrapHandler = (callback2, wrapper) => (e) => wrapper(callback2, e);
	if (modifiers.includes("dot")) event = dotSyntax(event);
	if (modifiers.includes("camel")) event = camelCase2(event);
	if (modifiers.includes("capture")) options.capture = true;
	if (modifiers.includes("window")) listenerTarget = window;
	if (modifiers.includes("document")) listenerTarget = document;
	if (modifiers.includes("passive")) options.passive = modifiers[modifiers.indexOf("passive") + 1] !== "false";
	handler4 = addDebounceOrThrottle(modifiers, handler4);
	if (modifiers.includes("prevent")) handler4 = wrapHandler(handler4, (next, e) => {
		e.preventDefault();
		next(e);
	});
	if (modifiers.includes("stop")) handler4 = wrapHandler(handler4, (next, e) => {
		e.stopPropagation();
		next(e);
	});
	if (modifiers.includes("once")) handler4 = wrapHandler(handler4, (next, e) => {
		next(e);
		listenerTarget.removeEventListener(event, handler4, options);
	});
	if (modifiers.includes("away") || modifiers.includes("outside")) {
		listenerTarget = document;
		handler4 = wrapHandler(handler4, (next, e) => {
			if (el.contains(e.target)) return;
			if (e.target.isConnected === false) return;
			if (el.offsetWidth < 1 && el.offsetHeight < 1) return;
			if (el._x_isShown === false) return;
			next(e);
		});
	}
	if (modifiers.includes("self")) handler4 = wrapHandler(handler4, (next, e) => {
		e.target === el && next(e);
	});
	if (event === "submit") handler4 = wrapHandler(handler4, (next, e) => {
		if (e.target._x_pendingModelUpdates) e.target._x_pendingModelUpdates.forEach((fn) => fn());
		next(e);
	});
	if (isKeyEvent(event) || isClickEvent(event)) handler4 = wrapHandler(handler4, (next, e) => {
		if (isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers)) return;
		next(e);
	});
	listenerTarget.addEventListener(event, handler4, options);
	return () => {
		listenerTarget.removeEventListener(event, handler4, options);
	};
}
function addDebounceOrThrottle(modifiers, handler4) {
	if (modifiers.includes("debounce")) {
		let nextModifier = modifiers[modifiers.indexOf("debounce") + 1] || "invalid-wait";
		let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
		handler4 = debounce(handler4, wait);
	}
	if (modifiers.includes("throttle")) {
		let nextModifier = modifiers[modifiers.indexOf("throttle") + 1] || "invalid-wait";
		let wait = isNumeric(nextModifier.split("ms")[0]) ? Number(nextModifier.split("ms")[0]) : 250;
		handler4 = throttle(handler4, wait);
	}
	return handler4;
}
function dotSyntax(subject) {
	return subject.replace(/-/g, ".");
}
function camelCase2(subject) {
	return subject.toLowerCase().replace(/-(\w)/g, (match, char) => char.toUpperCase());
}
function isNumeric(subject) {
	return !Array.isArray(subject) && !isNaN(subject);
}
function kebabCase2(subject) {
	if ([" ", "_"].includes(subject)) return subject;
	return subject.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[_\s]/, "-").toLowerCase();
}
function isKeyEvent(event) {
	return ["keydown", "keyup"].includes(event);
}
function isClickEvent(event) {
	return [
		"contextmenu",
		"click",
		"mouse"
	].some((i) => event.includes(i));
}
var nonKeyModifiers = [
	"window",
	"document",
	"prevent",
	"stop",
	"once",
	"capture",
	"self",
	"away",
	"outside",
	"passive",
	"dot",
	"camel",
	"preserve-scroll",
	"blur",
	"change",
	"lazy",
	"number",
	"boolean",
	"trim",
	"fill",
	"unintrusive",
	"parent"
];
function isListeningForASpecificKeyThatHasntBeenPressed(e, modifiers) {
	let keyModifiers = modifiers.filter((modifier, index) => {
		if (modifier === "false" && modifiers[index - 1] === "passive") return false;
		return !nonKeyModifiers.includes(modifier);
	});
	if (keyModifiers.includes("debounce")) {
		let debounceIndex = keyModifiers.indexOf("debounce");
		keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
	}
	if (keyModifiers.includes("throttle")) {
		let debounceIndex = keyModifiers.indexOf("throttle");
		keyModifiers.splice(debounceIndex, isNumeric((keyModifiers[debounceIndex + 1] || "invalid-wait").split("ms")[0]) ? 2 : 1);
	}
	if (keyModifiers.length === 0) return false;
	if (keyModifiers.length === 1 && keyToModifiers(e.key).includes(keyModifiers[0])) return false;
	const selectedSystemKeyModifiers = [
		"ctrl",
		"shift",
		"alt",
		"meta",
		"cmd",
		"super"
	].filter((modifier) => keyModifiers.includes(modifier));
	keyModifiers = keyModifiers.filter((i) => !selectedSystemKeyModifiers.includes(i));
	if (selectedSystemKeyModifiers.length > 0) {
		if (selectedSystemKeyModifiers.filter((modifier) => {
			if (modifier === "cmd" || modifier === "super") modifier = "meta";
			return e[`${modifier}Key`];
		}).length === selectedSystemKeyModifiers.length) {
			if (isClickEvent(e.type)) return false;
			if (keyToModifiers(e.key).includes(keyModifiers[0])) return false;
		}
	}
	return true;
}
function keyToModifiers(key) {
	if (!key) return [];
	key = kebabCase2(key);
	let modifierToKeyMap = {
		"ctrl": "control",
		"slash": "/",
		"space": " ",
		"spacebar": " ",
		"cmd": "meta",
		"esc": "escape",
		"up": "arrow-up",
		"down": "arrow-down",
		"left": "arrow-left",
		"right": "arrow-right",
		"period": ".",
		"comma": ",",
		"equal": "=",
		"minus": "-",
		"underscore": "_"
	};
	modifierToKeyMap[key] = key;
	return Object.keys(modifierToKeyMap).map((modifier) => {
		if (modifierToKeyMap[modifier] === key) return modifier;
	}).filter((modifier) => modifier);
}
directive("model", (el, { modifiers, expression }, { effect: effect3, cleanup }) => {
	let scopeTarget = el;
	if (modifiers.includes("parent")) scopeTarget = findClosest(el, (element) => element !== el);
	let evaluateGet = evaluateLater(scopeTarget, expression);
	let evaluateSet;
	if (typeof expression === "string") evaluateSet = evaluateLater(scopeTarget, `${expression} = __placeholder`);
	else if (typeof expression === "function" && typeof expression() === "string") evaluateSet = evaluateLater(scopeTarget, `${expression()} = __placeholder`);
	else evaluateSet = () => {};
	let getValue = () => {
		let result;
		evaluateGet((value) => result = value);
		return isGetterSetter(result) ? result.get() : result;
	};
	let setValue = (value) => {
		let result;
		evaluateGet((value2) => result = value2);
		if (isGetterSetter(result)) result.set(value);
		else evaluateSet(() => {}, { scope: { "__placeholder": value } });
	};
	if (typeof expression === "string" && el.type === "radio") mutateDom(() => {
		if (!el.hasAttribute("name")) el.setAttribute("name", expression);
	});
	let hasChangeModifier = modifiers.includes("change") || modifiers.includes("lazy");
	let hasBlurModifier = modifiers.includes("blur");
	let hasEnterModifier = modifiers.includes("enter");
	let hasExplicitEventModifiers = hasChangeModifier || hasBlurModifier || hasEnterModifier;
	let removeListener;
	if (isCloning) removeListener = () => {};
	else if (hasExplicitEventModifiers) {
		let listeners = [];
		let syncValue = (e) => setValue(getInputValue(el, modifiers, e, getValue()));
		if (hasChangeModifier) listeners.push(on(el, "change", modifiers, syncValue));
		if (hasBlurModifier) {
			listeners.push(on(el, "blur", modifiers, syncValue));
			if (el.form) {
				let form = el.form;
				let syncCallback = () => syncValue({ target: el });
				if (!form._x_pendingModelUpdates) form._x_pendingModelUpdates = [];
				form._x_pendingModelUpdates.push(syncCallback);
				cleanup(() => {
					if (form._x_pendingModelUpdates) form._x_pendingModelUpdates.splice(form._x_pendingModelUpdates.indexOf(syncCallback), 1);
				});
			}
		}
		if (hasEnterModifier) listeners.push(on(el, "keydown", modifiers, (e) => {
			if (e.key === "Enter") syncValue(e);
		}));
		removeListener = () => listeners.forEach((remove2) => remove2());
	} else removeListener = on(el, el.tagName.toLowerCase() === "select" || ["checkbox", "radio"].includes(el.type) ? "change" : "input", modifiers, (e) => {
		setValue(getInputValue(el, modifiers, e, getValue()));
	});
	if (modifiers.includes("fill")) {
		if ([
			void 0,
			null,
			""
		].includes(getValue()) || isCheckbox(el) && Array.isArray(getValue()) || el.tagName.toLowerCase() === "select" && el.multiple) setValue(getInputValue(el, modifiers, { target: el }, getValue()));
	}
	if (!el._x_removeModelListeners) el._x_removeModelListeners = {};
	el._x_removeModelListeners["default"] = removeListener;
	cleanup(() => el._x_removeModelListeners["default"]());
	if (el.form) {
		let removeResetListener = on(el.form, "reset", [], (e) => {
			nextTick(() => el._x_model && el._x_model.set(getInputValue(el, modifiers, { target: el }, getValue())));
		});
		cleanup(() => removeResetListener());
	}
	el._x_model = {
		get() {
			return getValue();
		},
		set(value) {
			setValue(value);
		},
		setWithModifiers: addDebounceOrThrottle(modifiers, setValue)
	};
	el._x_forceModelUpdate = (value) => {
		if (value === void 0 && typeof expression === "string" && expression.match(/\./)) value = "";
		mutateDom(() => {
			if (isCheckbox(el)) if (Array.isArray(value)) el.checked = value.some((val) => val == el.value);
			else el.checked = !!value;
			else if (isRadio(el)) if (typeof value === "boolean") el.checked = safeParseBoolean(el.value) === value;
			else el.checked = el.value == value;
			else bind(el, "value", value);
		});
	};
	if (el.tagName === "SELECT") {
		let observer2 = new MutationObserver(() => {
			el._x_forceModelUpdate(getValue());
		});
		observer2.observe(el, { childList: true });
		cleanup(() => observer2.disconnect());
	}
	effect3(() => {
		let value = getValue();
		if (modifiers.includes("unintrusive") && document.activeElement.isSameNode(el)) return;
		el._x_forceModelUpdate(value);
	});
});
function getInputValue(el, modifiers, event, currentValue) {
	return mutateDom(() => {
		if (event instanceof CustomEvent && event.detail !== void 0) return event.detail !== null && event.detail !== void 0 ? event.detail : event.target.value;
		else if (isCheckbox(el)) if (Array.isArray(currentValue)) {
			let newValue = null;
			if (modifiers.includes("number")) newValue = safeParseNumber(event.target.value);
			else if (modifiers.includes("boolean")) newValue = safeParseBoolean(event.target.value);
			else newValue = event.target.value;
			return event.target.checked ? currentValue.includes(newValue) ? currentValue : currentValue.concat([newValue]) : currentValue.filter((el2) => !checkedAttrLooseCompare2(el2, newValue));
		} else return event.target.checked;
		else if (el.tagName.toLowerCase() === "select" && el.multiple) {
			if (modifiers.includes("number")) return Array.from(event.target.selectedOptions).map((option) => {
				return safeParseNumber(option.value || option.text);
			});
			else if (modifiers.includes("boolean")) return Array.from(event.target.selectedOptions).map((option) => {
				return safeParseBoolean(option.value || option.text);
			});
			return Array.from(event.target.selectedOptions).map((option) => {
				return option.value || option.text;
			});
		} else {
			let newValue;
			if (isRadio(el)) if (event.target.checked) newValue = event.target.value;
			else newValue = currentValue;
			else newValue = event.target.value;
			if (modifiers.includes("number")) return safeParseNumber(newValue);
			else if (modifiers.includes("boolean")) return safeParseBoolean(newValue);
			else if (modifiers.includes("trim")) return newValue.trim();
			else return newValue;
		}
	});
}
function safeParseNumber(rawValue) {
	let number = rawValue ? parseFloat(rawValue) : null;
	return isNumeric2(number) ? number : rawValue;
}
function checkedAttrLooseCompare2(valueA, valueB) {
	return valueA == valueB;
}
function isNumeric2(subject) {
	return !Array.isArray(subject) && !isNaN(subject);
}
function isGetterSetter(value) {
	return value !== null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function";
}
directive("cloak", (el) => {
	if (isCloning) return el.removeAttribute(prefix("cloak"));
	queueMicrotask(() => mutateDom(() => el.removeAttribute(prefix("cloak"))));
});
addInitSelector(() => `[${prefix("init")}]`);
directive("init", skipDuringClone((el, { expression }, { evaluate: evaluate2 }) => {
	if (typeof expression === "string") return !!expression.trim() && evaluate2(expression, {}, false);
	return evaluate2(expression, {}, false);
}));
directive("text", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
	let evaluate2 = evaluateLater2(expression);
	effect3(() => {
		evaluate2((value) => {
			mutateDom(() => {
				el.textContent = value;
			});
		});
	});
});
directive("html", (el, { expression }, { effect: effect3, evaluateLater: evaluateLater2 }) => {
	let evaluate2 = evaluateLater2(expression);
	effect3(() => {
		evaluate2((value) => {
			mutateDom(() => {
				Array.from(el.children).forEach((child) => destroyTree(child));
				el.innerHTML = value ?? "";
				el._x_ignoreSelf = true;
				initTree(el);
				delete el._x_ignoreSelf;
			});
		});
	}, { priority: "structural" });
});
mapAttributes(startingWith(":", into(prefix("bind:"))));
var handler2 = (el, { value, modifiers, expression, original }, { effect: effect3, cleanup }) => {
	if (!value) {
		let bindingProviders = {};
		injectBindingProviders(bindingProviders);
		evaluateLater(el, expression)((bindings) => {
			applyBindingsObject(el, bindings, original);
		}, { scope: bindingProviders });
		return;
	}
	if (value === "key") return storeKeyForXFor(el, expression);
	if (el._x_inlineBindings && el._x_inlineBindings[value] && el._x_inlineBindings[value].extract) return;
	let evaluate2 = evaluateLater(el, expression);
	effect3(() => evaluate2((result) => {
		if (result === void 0 && typeof expression === "string" && expression.match(/\./)) result = "";
		mutateDom(() => bind(el, value, result, modifiers));
	}));
	cleanup(() => {
		el._x_undoAddedClasses && el._x_undoAddedClasses();
		el._x_undoAddedStyles && el._x_undoAddedStyles();
	});
};
handler2.inline = (el, { value, modifiers, expression }) => {
	if (!value) return;
	if (!el._x_inlineBindings) el._x_inlineBindings = {};
	el._x_inlineBindings[value] = {
		expression,
		extract: false
	};
};
directive("bind", handler2);
function storeKeyForXFor(el, expression) {
	el._x_keyExpression = expression;
}
addRootSelector(() => `[${prefix("data")}]`);
var dataForReconciliation = Symbol();
directive("data", (el, { expression }, { cleanup }) => {
	if (shouldSkipRegisteringDataDuringClone(el)) return;
	let dataToReconcile = el[dataForReconciliation];
	if (dataToReconcile?.expression === expression) return;
	expression = expression === "" ? "{}" : expression;
	let magicContext = {};
	injectMagics(magicContext, el);
	let dataProviderContext = {};
	injectDataProviders(dataProviderContext, magicContext);
	let data2 = evaluate$1(el, expression, { scope: dataProviderContext });
	if (data2 === void 0 || data2 === true) data2 = {};
	injectMagics(data2, el);
	let reactiveData;
	if (dataToReconcile?.reactiveData) {
		reactiveData = dataToReconcile.reactiveData;
		reconcileData(reactiveData, data2);
		let initialized = { expression };
		el[dataForReconciliation] = initialized;
		queueMicrotask(() => {
			if (el[dataForReconciliation] === initialized) delete el[dataForReconciliation];
		});
	} else reactiveData = reactive(data2);
	initInterceptors(reactiveData, cleanup);
	let undo = addScopeToNode(el, reactiveData);
	skipDuringClone(() => {
		reactiveData["init"] && evaluate$1(el, reactiveData["init"]);
	})();
	cleanup(() => {
		reactiveData["destroy"] && evaluate$1(el, reactiveData["destroy"]);
		undo();
		let removed = { reactiveData };
		el[dataForReconciliation] = removed;
		queueMicrotask(() => {
			if (el[dataForReconciliation] === removed) delete el[dataForReconciliation];
		});
	});
});
function reconcileData(target, source) {
	Object.keys(source).forEach((key) => {
		let descriptor = Object.getOwnPropertyDescriptor(source, key);
		let existingDescriptor = Object.getOwnPropertyDescriptor(target, key);
		if (descriptor.get || descriptor.set || existingDescriptor?.get || existingDescriptor?.set) {
			if (existingDescriptor) delete target[key];
			if (!existingDescriptor) target[key] = void 0;
			descriptor.get || descriptor.set ? Object.defineProperty(target, key, descriptor) : target[key] = source[key];
		} else target[key] = source[key];
	});
	Object.keys(target).filter((key) => !Object.prototype.hasOwnProperty.call(source, key)).forEach((key) => delete target[key]);
}
interceptClone((from, to) => {
	if (from._x_dataStack) {
		to._x_dataStack = from._x_dataStack;
		to.setAttribute("data-has-alpine-state", true);
	}
});
function shouldSkipRegisteringDataDuringClone(el) {
	if (!isCloning) return false;
	if (isCloningLegacy) return true;
	return el.hasAttribute("data-has-alpine-state");
}
directive("show", (el, { modifiers, expression }, { effect: effect3 }) => {
	let evaluate2 = evaluateLater(el, expression);
	if (!el._x_doHide) el._x_doHide = () => {
		mutateDom(() => {
			el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
		});
	};
	if (!el._x_doShow) el._x_doShow = () => {
		mutateDom(() => {
			if (el.style.length === 1 && el.style.display === "none") el.removeAttribute("style");
			else el.style.removeProperty("display");
		});
	};
	let hide = () => {
		el._x_doHide();
		el._x_isShown = false;
	};
	let show = () => {
		el._x_doShow();
		el._x_isShown = true;
	};
	let clickAwayCompatibleShow = () => setTimeout(show);
	let toggle = once((value) => value ? show() : hide(), (value) => {
		if (typeof el._x_toggleAndCascadeWithTransitions === "function") el._x_toggleAndCascadeWithTransitions(el, value, show, hide);
		else value ? clickAwayCompatibleShow() : hide();
	});
	let oldValue;
	let firstTime = true;
	effect3(() => evaluate2((value) => {
		if (!firstTime && value === oldValue) return;
		if (modifiers.includes("immediate")) value ? clickAwayCompatibleShow() : hide();
		toggle(value);
		oldValue = value;
		firstTime = false;
	}));
});
directive("for", skipDuringClone((el, { expression }, { effect: effect3, cleanup }) => {
	let iteratorNames = parseForExpression(expression);
	let evaluateItems = evaluateLater(el, iteratorNames.items);
	let evaluateKey = evaluateLater(el, el._x_keyExpression || "index");
	el._x_lookup = /* @__PURE__ */ new Map();
	effect3(() => loop(el, iteratorNames, evaluateItems, evaluateKey), { priority: "structural" });
	cleanup(() => {
		el._x_lookup.forEach((el2) => mutateDom(() => {
			destroyTree(el2);
			el2.remove();
		}));
		delete el._x_lookup;
		delete el._x_lastRenderedEl;
	});
}));
function refreshScope(scope2) {
	return (newScope) => {
		Object.entries(newScope).forEach(([key, value]) => {
			scope2[key] = value;
		});
	};
}
function loop(templateEl, iteratorNames, evaluateItems, evaluateKey) {
	evaluateItems((items) => {
		if (isNumeric3(items)) items = Array.from({ length: items }, (_, i) => i + 1);
		if (items === void 0 || items === null) items = [];
		if (items instanceof Set) items = Array.from(items);
		if (items instanceof Map) items = Array.from(items);
		let oldLookup = templateEl._x_lookup;
		let lookup = /* @__PURE__ */ new Map();
		templateEl._x_lookup = lookup;
		let hasStringKeys = isObject2(items);
		let scopeEntries = Object.entries(items).map(([index, item]) => {
			if (!hasStringKeys) index = parseInt(index);
			let scope2 = getIterationScopeVariables(iteratorNames, item, index, items);
			let key;
			evaluateKey((innerKey) => {
				if (typeof innerKey === "object") warn("x-for key cannot be an object, it must be a string or an integer", templateEl);
				if (oldLookup.has(innerKey)) {
					lookup.set(innerKey, oldLookup.get(innerKey));
					oldLookup.delete(innerKey);
				}
				key = innerKey;
			}, { scope: {
				index,
				...scope2
			} });
			return [key, scope2];
		});
		mutateDom(() => {
			oldLookup.forEach((el) => {
				destroyTree(el);
				el.remove();
			});
			let added = /* @__PURE__ */ new Set();
			let prev = templateEl;
			scopeEntries.forEach(([key, scope2]) => {
				if (lookup.has(key)) {
					let el = lookup.get(key);
					el._x_refreshXForScope(scope2);
					if (prev.nextElementSibling !== el) {
						if (prev.nextElementSibling) el.replaceWith(prev.nextElementSibling);
						prev.after(el);
					}
					prev = el;
					if (el._x_currentIfEl) {
						if (el.nextElementSibling !== el._x_currentIfEl) prev.after(el._x_currentIfEl);
						prev = el._x_currentIfEl;
					}
					return;
				}
				if (templateEl.content.children.length > 1) warn("x-for templates require a single root element, additional elements will be ignored.", templateEl);
				let clone2 = document.importNode(templateEl.content, true).firstElementChild;
				let reactiveScope = reactive(scope2);
				addScopeToNode(clone2, reactiveScope, templateEl);
				clone2._x_refreshXForScope = refreshScope(reactiveScope);
				lookup.set(key, clone2);
				added.add(clone2);
				prev.after(clone2);
				prev = clone2;
			});
			added.forEach((clone2) => initTree(clone2));
			if (prev !== templateEl) templateEl._x_lastRenderedEl = prev;
			else delete templateEl._x_lastRenderedEl;
		});
	});
}
function parseForExpression(expression) {
	let forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
	let stripParensRE = /^\s*\(|\)\s*$/g;
	let inMatch = expression.match(/([\s\S]*?)\b(?:in|of)\b([\s\S]*)/);
	if (!inMatch) return;
	let res = {};
	res.items = inMatch[2].trim();
	let item = inMatch[1].replace(stripParensRE, "").trim();
	let iteratorMatch = item.match(forIteratorRE);
	if (iteratorMatch) {
		res.item = item.replace(forIteratorRE, "").trim();
		res.index = iteratorMatch[1].trim();
		if (iteratorMatch[2]) res.collection = iteratorMatch[2].trim();
	} else res.item = item;
	return res;
}
function getIterationScopeVariables(iteratorNames, item, index, items) {
	let scopeVariables = {};
	if (/^\[.*\]$/.test(iteratorNames.item) && Array.isArray(item)) iteratorNames.item.replace("[", "").replace("]", "").split(",").map((i) => i.trim()).forEach((name, i) => {
		scopeVariables[name] = item[i];
	});
	else if (/^\{.*\}$/.test(iteratorNames.item) && !Array.isArray(item) && typeof item === "object") iteratorNames.item.replace("{", "").replace("}", "").split(",").map((i) => i.trim()).forEach((name) => {
		scopeVariables[name] = item[name];
	});
	else scopeVariables[iteratorNames.item] = item;
	if (iteratorNames.index) scopeVariables[iteratorNames.index] = index;
	if (iteratorNames.collection) scopeVariables[iteratorNames.collection] = items;
	return scopeVariables;
}
function isNumeric3(subject) {
	return typeof subject !== "object" && !isNaN(subject);
}
function isObject2(subject) {
	return typeof subject === "object" && !Array.isArray(subject);
}
function handler3() {}
handler3.inline = (el, { expression }, { cleanup }) => {
	let root = closestRoot(el);
	if (!root) return;
	if (!root._x_refs) root._x_refs = {};
	root._x_refs[expression] = el;
	cleanup(() => delete root._x_refs[expression]);
};
directive("ref", handler3);
directive("if", skipDuringClone((el, { expression }, { effect: effect3, cleanup }) => {
	if (el.tagName.toLowerCase() !== "template") warn("x-if can only be used on a <template> tag", el);
	let evaluate2 = evaluateLater(el, expression);
	let show = () => {
		if (el._x_currentIfEl) return el._x_currentIfEl;
		let clone2 = el.content.cloneNode(true).firstElementChild;
		addScopeToNode(clone2, {}, el);
		mutateDom(() => {
			el.after(clone2);
			initTree(clone2);
		});
		el._x_currentIfEl = clone2;
		el._x_lastRenderedEl = clone2;
		el._x_undoIf = () => {
			mutateDom(() => {
				destroyTree(clone2);
				clone2.remove();
			});
			delete el._x_currentIfEl;
			delete el._x_lastRenderedEl;
		};
		return clone2;
	};
	let hide = () => {
		if (!el._x_undoIf) return;
		el._x_undoIf();
		delete el._x_undoIf;
	};
	effect3(() => evaluate2((value) => {
		value ? show() : hide();
	}), { priority: "structural" });
	cleanup(() => el._x_undoIf && el._x_undoIf());
}));
directive("id", (el, { expression }, { evaluate: evaluate2 }) => {
	evaluate2(expression).forEach((name) => setIdRoot(el, name));
});
interceptClone((from, to) => {
	if (from._x_ids) to._x_ids = from._x_ids;
});
mapAttributes(startingWith("@", into(prefix("on:"))));
directive("on", skipDuringClone((el, { value, modifiers, expression }, { cleanup }) => {
	let evaluate2 = expression ? evaluateLater(el, expression) : () => {};
	if (el.tagName.toLowerCase() === "template") {
		if (!el._x_forwardEvents) el._x_forwardEvents = [];
		if (!el._x_forwardEvents.includes(value)) el._x_forwardEvents.push(value);
	}
	let removeListener = on(el, value, modifiers, (e) => {
		evaluate2(() => {}, {
			scope: { "$event": e },
			params: [e]
		});
	});
	cleanup(() => removeListener());
}));
warnMissingPluginDirective("Collapse", "collapse", "collapse");
warnMissingPluginDirective("Intersect", "intersect", "intersect");
warnMissingPluginDirective("Focus", "trap", "focus");
warnMissingPluginDirective("Mask", "mask", "mask");
function warnMissingPluginDirective(name, directiveName, slug) {
	directive(directiveName, (el) => warn(`You can't use [x-${directiveName}] without first installing the "${name}" plugin here: https://alpinejs.dev/plugins/${slug}`, el));
}
alpine_default.setEvaluator(normalEvaluator);
alpine_default.setRawEvaluator(normalRawEvaluator);
alpine_default.setReactivityEngine({
	reactive: reactive2,
	effect: (callback, options = {}) => {
		let runner;
		runner = effect2(callback, { scheduler: () => {
			if (!runner) return;
			options.scheduler ? options.scheduler(runner) : runner();
		} });
		return runner;
	},
	release: stop,
	raw: toRaw
});
var module_default = alpine_default;
/*! Bundled license information:

@vue/shared/dist/shared.esm-bundler.js:
(**
* @vue/shared v3.5.41
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**)

@vue/reactivity/dist/reactivity.esm-bundler.js:
(**
* @vue/reactivity v3.5.41
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**)
*/
//#endregion
//#region client/src/Calendar.ts
var startOfDay = (d) => {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
};
var addDays = (d, n) => {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
};
var sameDay = (a, b) => a.toDateString() === b.toDateString();
var toLocalInput = (d) => {
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
var STORAGE_KEY = "planning.calendar";
var STEP = 15;
var TAP_MINUTES = 60;
var LONG_PRESS_MS = 450;
var TAP_SLOP_PX = 8;
var DEFAULTS = {
	mode: "week",
	daysCount: 7,
	firstDay: 1,
	startHour: 7,
	endHour: 22
};
function loadSettings() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (saved && typeof saved === "object") return {
			...DEFAULTS,
			...saved
		};
	} catch {}
	return { ...DEFAULTS };
}
var Calendar = class {
	constructor() {
		this.settings = loadSettings();
		this.anchor = /* @__PURE__ */ new Date();
		this.events = [];
		this.gaps = [];
		this.now = /* @__PURE__ */ new Date();
		this.isMobile = false;
		this.selection = null;
		this.lastPoint = null;
		this.onRange = null;
		this.onSelect = null;
		this.drag = null;
		this.swipe = null;
		this.attached = false;
		this.suppressEventClickUntil = 0;
	}
	/** Wires media query + clock. Safe to call several times. */
	attach(onRange) {
		this.onRange = onRange;
		if (this.attached) return;
		this.attached = true;
		const mq = window.matchMedia("(max-width: 720px)");
		this.isMobile = mq.matches;
		mq.addEventListener("change", (e) => {
			this.isMobile = e.matches;
			this.onRange?.();
		});
		window.setInterval(() => {
			this.now = /* @__PURE__ */ new Date();
		}, 6e4);
	}
	get count() {
		return this.isMobile ? 1 : this.settings.daysCount;
	}
	get step() {
		return this.settings.mode === "week" && !this.isMobile ? 7 : this.count;
	}
	get first() {
		const a = startOfDay(this.anchor);
		if (this.settings.mode === "week" && !this.isMobile) return addDays(a, -((a.getDay() - this.settings.firstDay + 7) % 7));
		return a;
	}
	get days() {
		return Array.from({ length: this.count }, (_, i) => addDays(this.first, i));
	}
	get hours() {
		return Array.from({ length: this.settings.endHour - this.settings.startHour }, (_, i) => this.settings.startHour + i);
	}
	get range() {
		return {
			from: this.first.toISOString(),
			to: addDays(this.first, this.count).toISOString()
		};
	}
	get title() {
		const f = (d, o) => d.toLocaleDateString("fr-FR", o);
		const days = this.days;
		if (days.length === 1) return f(days[0], {
			weekday: "long",
			day: "numeric",
			month: "long",
			year: "numeric"
		});
		return `${f(days[0], {
			day: "numeric",
			month: "short"
		})} – ${f(days[days.length - 1], {
			day: "numeric",
			month: "short",
			year: "numeric"
		})}`;
	}
	key(d) {
		return startOfDay(d).getTime();
	}
	isToday(d) {
		return sameDay(d, this.now);
	}
	dayName(d) {
		return d.toLocaleDateString("fr-FR", { weekday: "short" });
	}
	dayNum(d) {
		return d.getDate();
	}
	longDay(d) {
		return d.toLocaleDateString("fr-FR", {
			weekday: "long",
			day: "numeric",
			month: "long"
		});
	}
	time(d) {
		return d.toLocaleTimeString("fr-FR", {
			hour: "2-digit",
			minute: "2-digit"
		});
	}
	changed() {
		this.onRange?.();
	}
	prev() {
		this.anchor = addDays(this.first, -this.step);
		this.changed();
	}
	next() {
		this.anchor = addDays(this.first, this.step);
		this.changed();
	}
	today() {
		this.anchor = /* @__PURE__ */ new Date();
		this.changed();
	}
	goTo(value) {
		if (value) {
			this.anchor = /* @__PURE__ */ new Date(`${value}T00:00`);
			this.changed();
		}
	}
	focusDay(d) {
		this.anchor = d;
		this.setView("day");
	}
	setView(view) {
		this.settings.mode = view === "day" ? "days" : "week";
		this.settings.daysCount = view === "day" ? 1 : 7;
		this.apply();
	}
	apply() {
		const s = this.settings;
		s.daysCount = Math.min(7, Math.max(1, Math.round(Number(s.daysCount)) || 7));
		s.startHour = Math.min(22, Math.max(0, Math.round(Number(s.startHour)) || 0));
		s.endHour = Math.min(24, Math.max(s.startHour + 1, Math.round(Number(s.endHour)) || 24));
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
		} catch {}
		this.changed();
	}
	reset() {
		this.settings = { ...DEFAULTS };
		this.apply();
	}
	/** Events of one day with lane assignment so overlapping events sit side by side. */
	layoutFor(day) {
		return this.layout(this.events, day);
	}
	gapsFor(day) {
		return this.layout(this.gaps, day);
	}
	/** Same layout for an arbitrary list of events (the room calendar draws one column per room). */
	layout(events, day) {
		const lo = new Date(day).setHours(this.settings.startHour, 0, 0, 0);
		const hi = new Date(day).setHours(this.settings.endHour, 0, 0, 0);
		const items = events.filter((e) => e.end.getTime() > lo && e.start.getTime() < hi).map((ev) => {
			const s = Math.max(ev.start.getTime(), lo);
			const e = Math.min(ev.end.getTime(), hi);
			return {
				ev,
				s,
				e,
				min: (s - lo) / 6e4,
				len: (e - s) / 6e4,
				lane: 0,
				lanes: 1
			};
		}).sort((a, b) => a.s - b.s || b.e - a.e);
		let cluster = [];
		let clusterEnd = 0;
		const flush = () => {
			const n = Math.max(...cluster.map((c) => c.lane)) + 1;
			cluster.forEach((c) => {
				c.lanes = n;
			});
			cluster = [];
		};
		for (const it of items) {
			if (cluster.length && it.s >= clusterEnd) flush();
			const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.lane));
			let lane = 0;
			while (used.has(lane)) lane++;
			it.lane = lane;
			cluster.push(it);
			clusterEnd = cluster.length === 1 ? it.e : Math.max(clusterEnd, it.e);
		}
		if (cluster.length) flush();
		return items;
	}
	/** CSS custom properties consumed by style.css (see the x-place directive). */
	place(p) {
		return {
			"--start": p.min,
			"--dur": p.len,
			"--lane": p.lane,
			"--lanes": p.lanes
		};
	}
	selectionFor(day) {
		const s = this.selection;
		if (!s || !sameDay(s.day, day)) return null;
		return {
			"--start": s.from - this.settings.startHour * 60,
			"--dur": s.to - s.from
		};
	}
	selectionLabel() {
		const s = this.selection;
		if (!s) return "";
		const t = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
		return `${t(s.from)} – ${t(s.to)}`;
	}
	/** Minutes since the start of the visible hours for the "now" line, or null. */
	nowMin(day) {
		if (!sameDay(day, this.now)) return null;
		const m = this.now.getHours() * 60 + this.now.getMinutes() - this.settings.startHour * 60;
		return m >= 0 && m <= this.hours.length * 60 ? m : null;
	}
	scrollToNow(el) {
		if (!el) return;
		const perHour = el.scrollHeight / Math.max(1, this.hours.length);
		const h = this.days.some((d) => this.isToday(d)) ? this.now.getHours() - 1 : 8;
		el.scrollTop = Math.max(0, h - this.settings.startHour) * perHour;
	}
	minutesAt(e, col) {
		const r = col.getBoundingClientRect();
		const lo = this.settings.startHour * 60;
		const hi = this.settings.endHour * 60 - STEP;
		const raw = lo + (e.clientY - r.top) / r.height * (hi + STEP - lo);
		return Math.min(hi, Math.max(lo, Math.floor(raw / STEP) * STEP));
	}
	rawMinutesAt(e, col) {
		const r = col.getBoundingClientRect();
		const lo = this.settings.startHour * 60;
		const hi = this.settings.endHour * 60;
		return Math.min(hi, Math.max(lo, lo + (e.clientY - r.top) / r.height * (hi - lo)));
	}
	/**
	* Mouse: a click on an empty space creates a 1 h slot, a drag draws the slot.
	* Touch (and mouse): holding still on the same quarter hour opens a slot that the drag then stretches.
	* A finger that moves before the long press scrolls the page as usual.
	* A click on an event opens it (handled by the template); a drag or long press over it draws a new slot
	* and reports that event as the origin (the agent agenda books a meeting when it is an availability).
	*/
	down(e, day) {
		const mouse = e.pointerType === "mouse";
		if (mouse && e.button !== 0) return;
		this.clearTimer();
		const eventEl = e.target.closest("[data-event]");
		const col = e.currentTarget;
		const captureEl = eventEl ?? col;
		const y0 = this.minutesAt(e, col);
		const d = {
			day,
			col,
			captureEl,
			y0,
			y0Raw: this.rawMinutesAt(e, col),
			x0: e.clientX,
			yPx0: e.clientY,
			moved: false,
			pressed: false,
			onEvent: !!eventEl,
			mouse,
			pointerId: e.pointerId,
			timer: 0,
			origin: this.events.find((x) => x.id === eventEl?.dataset.eventId) ?? null
		};
		d.timer = window.setTimeout(() => this.longPress(), LONG_PRESS_MS);
		this.drag = d;
		this.selection = null;
		this.lastPoint = this.dateAt(day, y0);
		if (mouse) this.capture(d);
	}
	longPress() {
		const d = this.drag;
		if (!d || d.moved) return;
		d.pressed = true;
		d.timer = 0;
		this.capture(d);
		this.selection = {
			day: d.day,
			from: d.y0,
			to: d.y0 + STEP
		};
		navigator.vibrate?.(15);
	}
	move(e) {
		const d = this.drag;
		if (!d || d.pointerId !== e.pointerId) return;
		if (!d.mouse && !d.pressed) {
			if (Math.hypot(e.clientX - d.x0, e.clientY - d.yPx0) > TAP_SLOP_PX) this.cancel();
			return;
		}
		if (!d.pressed && !d.moved && Math.abs(this.rawMinutesAt(e, d.col) - d.y0Raw) > STEP) {
			d.moved = true;
			this.clearTimer();
		}
		if (d.moved || d.pressed) {
			const m = this.minutesAt(e, d.col);
			this.selection = {
				day: d.day,
				from: Math.min(d.y0, m),
				to: Math.max(d.y0, m) + STEP
			};
			e.preventDefault();
		}
	}
	/** Touch: once the slot is open, the finger stretches it instead of scrolling the page. */
	touchMove(e) {
		if (this.drag?.pressed && e.cancelable) e.preventDefault();
	}
	up(e) {
		const d = this.drag;
		if (!d || d.pointerId !== e.pointerId) return;
		this.clearTimer();
		this.drag = null;
		if (d.captureEl.hasPointerCapture(e.pointerId)) d.captureEl.releasePointerCapture(e.pointerId);
		const sel = this.selection;
		if ((d.moved || d.pressed) && sel) {
			this.suppressEventClickUntil = Date.now() + 500;
			this.onSelect?.(this.dateAt(d.day, sel.from), this.dateAt(d.day, sel.to), d.origin);
			return;
		}
		this.selection = null;
		if (!d.onEvent) {
			const to = Math.min(d.y0 + TAP_MINUTES, this.settings.endHour * 60);
			this.selection = {
				day: d.day,
				from: d.y0,
				to
			};
			this.onSelect?.(this.dateAt(d.day, d.y0), this.dateAt(d.day, to), null);
		}
	}
	capture(d) {
		try {
			d.captureEl.setPointerCapture(d.pointerId);
		} catch {}
	}
	clearTimer() {
		if (this.drag?.timer) window.clearTimeout(this.drag.timer);
	}
	dateAt(day, minutes) {
		const x = new Date(day);
		x.setHours(0, minutes, 0, 0);
		return x;
	}
	shouldSuppressEventClick() {
		return Date.now() < this.suppressEventClickUntil;
	}
	cancel() {
		this.clearTimer();
		this.drag = null;
		this.selection = null;
	}
	swipeStart(e) {
		const t = e.changedTouches[0];
		this.swipe = {
			x: t.clientX,
			y: t.clientY
		};
	}
	swipeEnd(e) {
		const s = this.swipe;
		this.swipe = null;
		if (!s) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - s.x;
		const dy = t.clientY - s.y;
		if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) if (dx < 0) this.next();
		else this.prev();
	}
};
/** A Monday (local time): the "Habitudes" page draws this week, whatever the real date. */
var HABIT_WEEK = new Date(2001, 0, 1);
/**
* Week template of the "Habitudes" page: one fixed reference week, days shown by name only (no dates).
* Navigation (one day at a time on a phone) wraps inside that week; the weekday of a column is all that matters.
*/
var HabitCalendar = class extends Calendar {
	constructor() {
		super();
		this.anchor = new Date(HABIT_WEEK);
	}
	get count() {
		return this.isMobile ? 1 : 7;
	}
	get step() {
		return this.isMobile ? 1 : 7;
	}
	get first() {
		if (this.isMobile) return startOfDay(this.anchor);
		const a = startOfDay(HABIT_WEEK);
		return addDays(a, -((a.getDay() - this.settings.firstDay + 7) % 7));
	}
	get title() {
		if (!this.isMobile) return "Semaine type";
		const day = this.longDay(this.first);
		return day.charAt(0).toUpperCase() + day.slice(1);
	}
	/** Same weekday, inside the reference week. */
	wrap(d) {
		const base = startOfDay(HABIT_WEEK);
		return addDays(base, (Math.round((startOfDay(d).getTime() - base.getTime()) / 864e5) % 7 + 7) % 7);
	}
	prev() {
		this.anchor = this.wrap(addDays(this.anchor, -1));
		this.onRange?.();
	}
	next() {
		this.anchor = this.wrap(addDays(this.anchor, 1));
		this.onRange?.();
	}
	today() {
		this.anchor = this.wrap(/* @__PURE__ */ new Date());
		this.onRange?.();
	}
	/** The column of today's weekday is highlighted, with the "now" line. */
	isToday(d) {
		return d.getDay() === this.now.getDay();
	}
	longDay(d) {
		return d.toLocaleDateString("fr-FR", { weekday: "long" });
	}
	nowMin(day) {
		if (!this.isToday(day)) return null;
		const m = this.now.getHours() * 60 + this.now.getMinutes() - this.settings.startHour * 60;
		return m >= 0 && m <= this.hours.length * 60 ? m : null;
	}
};
//#endregion
//#region client/src/Results.ts
var STATE_LABEL = {
	pending: "En attente",
	past: "Fait",
	done: "Terminé"
};
var STATE_RANK = {
	pending: 0,
	past: 1,
	done: 2
};
var STATES = [
	"pending",
	"past",
	"done"
];
var FIELD_LABEL = {
	date: "Date",
	agent: "Agent",
	consumer: "Consommateur",
	state: "État",
	duration: "Durée",
	rate: "Prix horaire",
	paid: "Payé",
	society: "Perçu (société)",
	share: "Part de l’agent"
};
var cents = (n) => Math.round(n * 100) / 100;
var person = (p) => [p?.name, p?.surname].filter(Boolean).join(" ");
var collator = new Intl.Collator("fr", {
	sensitivity: "base",
	numeric: true
});
/** State of a meeting at a given moment (cancelled meetings are not part of the results). */
function meetingState(m, now = /* @__PURE__ */ new Date()) {
	if (m.status === "done") return "done";
	return Date.parse(m.startAt) + m.durationMinutes * 6e4 <= now.getTime() ? "past" : "pending";
}
var ResultsView = class {
	constructor() {
		this.mode = "admin";
		this.meetings = [];
		this.assignations = [];
		this.menuOpen = false;
		this.hiddenAgents = {};
		this.hiddenConsumers = {};
		this.hiddenStates = {};
		this.sorts = [];
	}
	/** Loads the data of the page; the filters chosen by the user are kept. */
	setData(mode, meetings, assignations) {
		this.mode = mode;
		this.meetings = meetings;
		this.assignations = assignations;
		const allowed = new Set(this.fields().map((f) => f.value));
		this.sorts = this.sorts.filter((s) => allowed.has(s.field));
	}
	/** Forgets everything (logout). */
	clear() {
		this.meetings = [];
		this.assignations = [];
		this.hiddenAgents = {};
		this.hiddenConsumers = {};
		this.hiddenStates = {};
		this.sorts = [];
	}
	get isAdmin() {
		return this.mode === "admin";
	}
	/** Sortable columns of the viewer. */
	fields() {
		return (this.isAdmin ? [
			"date",
			"agent",
			"consumer",
			"state",
			"duration",
			"rate",
			"paid",
			"society",
			"share"
		] : [
			"date",
			"consumer",
			"state",
			"duration",
			"rate",
			"share"
		]).map((value) => ({
			value,
			label: value === "rate" && !this.isAdmin ? "Gain horaire" : value === "share" && !this.isAdmin ? "Mon gain" : FIELD_LABEL[value]
		}));
	}
	fieldLabel(f) {
		return this.fields().find((x) => x.value === f)?.label ?? FIELD_LABEL[f];
	}
	stateLabel(s) {
		return STATE_LABEL[s];
	}
	states() {
		return STATES;
	}
	agentOptions() {
		const seen = /* @__PURE__ */ new Map();
		for (const a of this.assignations) if (a.agent && !seen.has(a.agent.id)) seen.set(a.agent.id, person(a.agent) || "Agent");
		return [...seen].map(([id, label]) => ({
			id,
			label
		})).sort((x, y) => collator.compare(x.label, y.label));
	}
	consumerOptions() {
		const seen = /* @__PURE__ */ new Map();
		for (const a of this.assignations) if (a.consumer && !seen.has(a.consumer.id)) seen.set(a.consumer.id, person(a.consumer) || "Consommateur");
		return [...seen].map(([id, label]) => ({
			id,
			label
		})).sort((x, y) => collator.compare(x.label, y.label));
	}
	isAgentShown(id) {
		return this.hiddenAgents[id] !== true;
	}
	isConsumerShown(id) {
		return this.hiddenConsumers[id] !== true;
	}
	isStateShown(s) {
		return this.hiddenStates[s] !== true;
	}
	toggleAgent(id) {
		this.hiddenAgents = {
			...this.hiddenAgents,
			[id]: this.isAgentShown(id)
		};
	}
	toggleConsumer(id) {
		this.hiddenConsumers = {
			...this.hiddenConsumers,
			[id]: this.isConsumerShown(id)
		};
	}
	toggleState(s) {
		this.hiddenStates = {
			...this.hiddenStates,
			[s]: this.isStateShown(s)
		};
	}
	setAllAgents(on) {
		this.hiddenAgents = Object.fromEntries(this.agentOptions().map((a) => [a.id, !on]));
	}
	setAllConsumers(on) {
		this.hiddenConsumers = Object.fromEntries(this.consumerOptions().map((c) => [c.id, !on]));
	}
	setAllStates(on) {
		this.hiddenStates = Object.fromEntries(STATES.map((s) => [s, !on]));
	}
	allAgentsShown() {
		return this.agentOptions().every((a) => this.isAgentShown(a.id));
	}
	allConsumersShown() {
		return this.consumerOptions().every((c) => this.isConsumerShown(c.id));
	}
	allStatesShown() {
		return STATES.every((s) => this.isStateShown(s));
	}
	/** Number of hidden entries, shown on the menu button. */
	hiddenCount() {
		const n = (o) => Object.values(o).filter(Boolean).length;
		return n(this.hiddenAgents) + n(this.hiddenConsumers) + n(this.hiddenStates);
	}
	resetFilters() {
		this.hiddenAgents = {};
		this.hiddenConsumers = {};
		this.hiddenStates = {};
	}
	/** A field can only be used by one rule: the other fields stay available for the other rules. */
	isFieldTaken(field, ruleIndex) {
		return this.sorts.some((s, i) => i !== ruleIndex && s.field === field);
	}
	canAddSort() {
		return this.fields().some((f) => !this.sorts.some((s) => s.field === f.value));
	}
	addSort() {
		const free = this.fields().find((f) => !this.sorts.some((s) => s.field === f.value));
		if (free) this.sorts = [...this.sorts, {
			field: free.value,
			dir: "asc"
		}];
	}
	removeSort(i) {
		this.sorts = this.sorts.filter((_, k) => k !== i);
	}
	setSortField(i, field) {
		this.sorts = this.sorts.map((s, k) => k === i ? {
			...s,
			field
		} : s);
	}
	toggleSortDir(i) {
		this.sorts = this.sorts.map((s, k) => k === i ? {
			...s,
			dir: s.dir === "asc" ? "desc" : "asc"
		} : s);
	}
	/** Moves a rule up (delta -1) or down (+1): its priority changes. */
	moveSort(i, delta) {
		const j = i + delta;
		if (j < 0 || j >= this.sorts.length) return;
		const list = [...this.sorts];
		[list[i], list[j]] = [list[j], list[i]];
		this.sorts = list;
	}
	resetSorts() {
		this.sorts = [];
	}
	sortValue(r, field) {
		switch (field) {
			case "date": return Date.parse(r.start);
			case "agent": return r.agent;
			case "consumer": return r.consumer;
			case "state": return STATE_RANK[r.state];
			case "duration": return r.minutes;
			case "rate": return r.rate;
			case "paid": return r.paid;
			case "society": return r.society;
			case "share": return r.share;
		}
	}
	compare(a, b) {
		for (const rule of this.sorts) {
			const x = this.sortValue(a, rule.field), y = this.sortValue(b, rule.field);
			const c = typeof x === "string" ? collator.compare(x, String(y)) : x - y;
			if (c !== 0) return rule.dir === "asc" ? c : -c;
		}
		return Date.parse(a.start) - Date.parse(b.start) || a.id - b.id;
	}
	row(m, a, now) {
		const minutes = m.actualDurationMinutes ?? m.durationMinutes;
		const hours = minutes / 60;
		let rate, paid = 0, society = 0, share;
		if (this.isAdmin) {
			const price = (m.hourlyRate ?? 0) * hours;
			const divider = 1 + (m.societyRate ?? 0) / 100;
			rate = m.hourlyRate ?? 0;
			paid = cents(price);
			share = cents(price / divider);
			society = cents(paid - share);
		} else {
			rate = m.agentHourlyRate ?? 0;
			share = cents(rate * hours);
		}
		return {
			id: m.id,
			agent: person(a.agent) || "Agent",
			consumer: person(a.consumer) || "Consommateur",
			start: m.startAt,
			minutes,
			plannedMinutes: m.durationMinutes,
			hours,
			status: m.status,
			state: meetingState(m, now),
			rate,
			paid,
			society,
			share,
			comment: m.comment ?? ""
		};
	}
	/** Meetings (not cancelled) after the filters, grouped by month, rows sorted by the rules. */
	months() {
		const now = /* @__PURE__ */ new Date();
		const months = /* @__PURE__ */ new Map();
		for (const m of this.meetings) {
			if (m.status === "canceledBy") continue;
			const a = this.assignations.find((x) => x.id === m.assignationId);
			if (!a) continue;
			if (this.isAdmin && a.agent && !this.isAgentShown(a.agent.id)) continue;
			if (a.consumer && !this.isConsumerShown(a.consumer.id)) continue;
			const row = this.row(m, a, now);
			if (!this.isStateShown(row.state)) continue;
			const d = new Date(m.startAt);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
			if (!months.has(key)) months.set(key, {
				key,
				label: d.toLocaleDateString("fr-FR", {
					month: "long",
					year: "numeric"
				}),
				rows: [],
				paid: 0,
				society: 0,
				share: 0,
				hours: 0
			});
			const month = months.get(key);
			month.rows.push(row);
			month.paid = cents(month.paid + row.paid);
			month.society = cents(month.society + row.society);
			month.share = cents(month.share + row.share);
			month.hours += row.hours;
		}
		for (const month of months.values()) month.rows.sort((x, y) => this.compare(x, y));
		const asc = this.sorts.find((s) => s.field === "date")?.dir === "asc";
		return [...months.values()].sort((x, y) => (x.key < y.key ? 1 : -1) * (asc ? -1 : 1));
	}
	/** Totals of everything displayed. */
	totals() {
		const t = {
			paid: 0,
			society: 0,
			share: 0,
			hours: 0,
			count: 0
		};
		for (const month of this.months()) {
			t.paid = cents(t.paid + month.paid);
			t.society = cents(t.society + month.society);
			t.share = cents(t.share + month.share);
			t.hours += month.hours;
			t.count += month.rows.length;
		}
		return t;
	}
};
//#endregion
//#region client/src/fetcher.ts
var TOKEN_KEY = "planning.token";
var ApiError = class extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
};
var camel = (s) => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
function camelize(value) {
	if (Array.isArray(value)) return value.map(camelize);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelize(v)]));
	return value;
}
var Fetcher = class {
	constructor() {
		this.token = null;
		this.onUnauthorized = null;
		this.get = (path, query) => this.request("GET", path, { query });
		this.post = (path, body = {}) => this.request("POST", path, { body });
		this.patch = (path, body) => this.request("PATCH", path, { body });
		this.del = (path) => this.request("DELETE", path);
		try {
			this.token = sessionStorage.getItem(TOKEN_KEY);
		} catch {}
	}
	setToken(token) {
		this.token = token;
		try {
			if (token) sessionStorage.setItem(TOKEN_KEY, token);
			else sessionStorage.removeItem(TOKEN_KEY);
		} catch {}
	}
	async request(method, path, opts = {}) {
		const url = new URL(path, window.SERVER_ADDRESS);
		for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== void 0 && v !== null && v !== "") url.searchParams.set(k, String(v));
		const headers = {};
		if (opts.body !== void 0) headers["Content-Type"] = "application/json";
		if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
		let res;
		try {
			res = await fetch(url, {
				method,
				headers,
				body: opts.body === void 0 ? void 0 : JSON.stringify(opts.body)
			});
		} catch {
			throw new ApiError(0, "Serveur injoignable. Vérifiez votre connexion puis réessayez.");
		}
		let data = null;
		try {
			data = await res.json();
		} catch {}
		if (!res.ok) {
			if (res.status === 401 && this.token) this.onUnauthorized?.();
			throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}.`);
		}
		return camelize(data);
	}
	adminSignup(b) {
		return this.post("/api/admin/signup", b);
	}
	adminLogin(username, password) {
		return this.post("/api/admin/login", {
			username,
			password
		});
	}
	agentLogin(username, password) {
		return this.post("/api/agent/login", {
			username,
			password
		});
	}
	consumerAccess(key, password) {
		return this.post("/api/consumer/access", {
			key,
			password: password || void 0
		});
	}
	me() {
		return this.get("/api/me");
	}
	logout() {
		return this.post("/api/logout");
	}
	companies() {
		return this.get("/api/companies");
	}
	/** Percentage the company takes on the agent (default 28): 32 EUR paid = 25 EUR for the agent + 7 EUR for the company. */
	updateSocietyRate(societyRate) {
		return this.patch("/api/companies/current", { societyRate });
	}
	consumers() {
		return this.get("/api/consumers");
	}
	searchConsumers(q) {
		return this.get("/api/consumers/search", {
			q,
			limit: 20
		});
	}
	createConsumer(b) {
		return this.post("/api/consumers", b);
	}
	agents() {
		return this.get("/api/agents");
	}
	createAgent(b) {
		return this.post("/api/agents", b);
	}
	/** Enrols an existing consumer in the admin's company (creates a Fidelity and its access key). */
	enrollConsumer(consumerId) {
		return this.post("/api/fidelities", { consumerId });
	}
	/** Assigns an agent to a consumer's Fidelity (creates an Assignation). */
	assign(agentId, fidelityId) {
		return this.post("/api/assignations", {
			agentId,
			fidelityId
		});
	}
	assignations() {
		return this.get("/api/assignations");
	}
	deleteAssignation(id) {
		return this.del(`/api/assignations/${id}`);
	}
	searchAgents(q) {
		return this.get("/api/agents/search", {
			q,
			limit: 20
		});
	}
	/** Attaches an existing agent to the admin's company (creates a Contract). */
	attachAgent(agentId) {
		return this.post("/api/contracts", { agentId });
	}
	/** Removes an agent from the admin's company. */
	removeAgent(agentId) {
		return this.del(`/api/agents/${agentId}`);
	}
	rooms() {
		return this.get("/api/rooms");
	}
	createRoom(name, limit) {
		return this.post("/api/rooms", {
			name,
			limit
		});
	}
	renameRoom(name, newName) {
		return this.patch(`/api/rooms/${encodeURIComponent(name)}`, { newName });
	}
	updateRoomLimit(name, limit) {
		return this.patch(`/api/rooms/${encodeURIComponent(name)}`, { limit });
	}
	deactivateRoom(name) {
		return this.del(`/api/rooms/${encodeURIComponent(name)}`);
	}
	/** Saves every room in one request: the array order is the display order. */
	saveRooms(rooms) {
		return this.request("PUT", "/api/rooms", { body: { rooms } });
	}
	/** Gives a room to the room-less pending meetings of a period (rooms with limit -1 are never used). */
	autoAssignRooms(from, to) {
		return this.post("/api/rooms/auto-assign", {
			from,
			to
		});
	}
	roomsAvailability(startAt, durationMinutes) {
		return this.get("/api/rooms/availability", {
			startAt,
			durationMinutes
		});
	}
	packages() {
		return this.get("/api/packages");
	}
	createPackage(name, hourlyRate) {
		return this.post("/api/packages", {
			name,
			hourlyRate
		});
	}
	deletePackage(id) {
		return this.del(`/api/packages/${id}`);
	}
	/** Default package of a consumer in the admin's company (null = not defined, price 0). */
	setConsumerPackage(fidelityId, defaultPackageId) {
		return this.patch(`/api/fidelities/${fidelityId}`, { defaultPackageId });
	}
	/** Package of an agent/consumer pair (null = the consumer's default package). */
	setAssignationPackage(assignationId, packageId) {
		return this.patch(`/api/assignations/${assignationId}`, { packageId });
	}
	agenda(from, to) {
		return this.get("/api/agenda", {
			from,
			to
		});
	}
	createRequest(assignationId, requestedHours) {
		return this.post("/api/availability-requests", {
			assignationId,
			requestedHours
		});
	}
	/** Changes the hours of a request at any time; null removes the limit. */
	updateRequestHours(id, requestedHours) {
		return this.patch(`/api/availability-requests/${id}`, { requestedHours });
	}
	disponibilities(q) {
		return this.get("/api/disponibilities", q);
	}
	createDispo(b) {
		return this.post("/api/disponibilities", b);
	}
	updateDispo(id, b) {
		return this.patch(`/api/disponibilities/${id}`, b);
	}
	deleteDispo(id) {
		return this.del(`/api/disponibilities/${id}`);
	}
	myConsumers() {
		return this.get("/api/my-consumers");
	}
	/** Intercourse ("intercours"): minutes the agent needs between two meetings (default of one consumer, or of a pair). */
	setIntercourse(assignationId, intercourseMinutes) {
		return this.patch(`/api/my-consumers/${assignationId}`, { intercourseMinutes });
	}
	intercoursePairs() {
		return this.get("/api/intercourse-pairs");
	}
	/** minutes null removes the pair value (back to max of both defaults). */
	setIntercoursePair(assignationA, assignationB, minutes) {
		return this.request("PUT", "/api/intercourse-pairs", { body: {
			assignationA,
			assignationB,
			minutes
		} });
	}
	suggestions(q) {
		return this.get("/api/suggestions", q);
	}
	createSuggestion(b) {
		return this.post("/api/suggestions", b);
	}
	updateSuggestion(id, b) {
		return this.patch(`/api/suggestions/${id}`, b);
	}
	deleteSuggestion(id) {
		return this.del(`/api/suggestions/${id}`);
	}
	createMeeting(b) {
		return this.post("/api/meetings/from-availability", b);
	}
	/** status "done" validates the meeting; actualDurationMinutes is then the time really spent (default: the booked duration). */
	patchMeeting(id, b) {
		return this.patch(`/api/meetings/${id}`, b);
	}
	cancelMeeting(id) {
		return this.post(`/api/meetings/${id}/cancel`);
	}
	createGenerator(b) {
		return this.post("/api/generators", b);
	}
	updateGenerator(id, b) {
		return this.patch(`/api/generators/${id}`, b);
	}
	deleteGenerator(id) {
		return this.del(`/api/generators/${id}`);
	}
	/** Cancels one occurrence ("cancelator"), by its local date YYYY-MM-DD. */
	cancelOccurrence(id, occurrence) {
		return this.post(`/api/generators/${id}/cancellations`, { occurrence });
	}
	restoreOccurrence(id, occurrence) {
		return this.del(`/api/generators/${id}/cancellations/${encodeURIComponent(occurrence)}`);
	}
	script() {
		return this.get("/api/agent/script");
	}
	saveScript(b) {
		return this.request("PUT", "/api/agent/script", { body: b });
	}
	/** value null removes the secret; secrets that are not listed are kept. */
	updateSecrets(secrets) {
		return this.patch("/api/agent/script/secrets", { secrets });
	}
	/** Runs the code (unsaved draft) on one of my meetings, or on a sample event when meetingId is null. */
	testScript(b) {
		return this.post("/api/agent/script/test", b);
	}
	scriptRuns() {
		return this.get("/api/agent/script/runs");
	}
};
var fetcher = new Fetcher();
//#endregion
//#region client/src/Planner.ts
var STEP_MS = 15 * 6e4;
var ITERATIONS = 120;
/** Serving one more consumer always beats any amount of preference. */
var NEW_CONSUMER_BONUS = 1e3;
var span = (x) => {
	const s = Date.parse(x.startAt);
	return {
		s,
		e: s + x.durationMinutes * 6e4
	};
};
/** Lowest love of the rows when they cover [s, e) without a hole, else null. Rows are sorted by start. */
function coverLove(rows, s, e) {
	let at = s;
	let love = 1;
	for (const r of rows) {
		if (r.e <= at) continue;
		if (r.s > at) return null;
		love = Math.min(love, r.love);
		at = r.e;
		if (at >= e) return love;
	}
	return null;
}
function plan(input) {
	const earliest = Math.max(input.from, Math.ceil((input.now + 6e4) / STEP_MS) * STEP_MS);
	const hours = /* @__PURE__ */ new Map();
	for (const x of input.suggestions) {
		const companyId = input.contracts.find((c) => c.id === x.contractId)?.companyId;
		if (companyId === void 0) continue;
		const list = hours.get(companyId) ?? [];
		list.push({
			...span(x),
			love: x.love ?? .5
		});
		hours.set(companyId, list);
	}
	for (const list of hours.values()) list.sort((a, b) => a.s - b.s);
	const fixed = input.meetings.map((m) => ({
		assignationId: m.assignationId,
		...span(m)
	}));
	const byRequest = /* @__PURE__ */ new Map();
	for (const d of input.dispos) {
		const k = `${d.assignationId}/${d.requestId}`;
		const list = byRequest.get(k) ?? [];
		list.push({
			...span(d),
			love: d.love ?? .5
		});
		byRequest.set(k, list);
	}
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	for (const d of input.dispos) {
		const minutes = Math.floor(Math.min(input.maxMinutes, input.remaining.get(d.requestId) ?? Infinity) / 15) * 15;
		if (minutes < 15) continue;
		const dur = minutes * 6e4;
		const companyId = input.assignations.find((a) => a.id === d.assignationId)?.companyId;
		const agentRows = companyId === void 0 ? void 0 : hours.get(companyId);
		if (!agentRows) continue;
		const rows = byRequest.get(`${d.assignationId}/${d.requestId}`).sort((a, b) => a.s - b.s);
		const w = span(d);
		for (let s = Math.max(earliest, Math.ceil(w.s / STEP_MS) * STEP_MS); s < w.e && s + dur <= input.to; s += STEP_MS) {
			const key = `${d.assignationId}/${d.requestId}/${s}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const e = s + dur;
			const dl = coverLove(rows, s, e);
			const al = dl === null ? null : coverLove(agentRows, s, e);
			if (dl === null || al === null) continue;
			const c = {
				assignationId: d.assignationId,
				s,
				e,
				score: 1 + dl + al
			};
			if (fits(c, fixed, input.gap)) candidates.push(c);
		}
	}
	if (!candidates.length) return [];
	const byConsumer = /* @__PURE__ */ new Map();
	for (const c of candidates) {
		const list = byConsumer.get(c.assignationId) ?? [];
		list.push(c);
		byConsumer.set(c.assignationId, list);
	}
	let best = {
		value: -1,
		chosen: []
	};
	for (let it = 0; it < ITERATIONS; it++) {
		const noise = it === 0 ? 0 : .6;
		const chosen = construct(byConsumer, fixed, input.gap, noise);
		const value = evaluate(chosen);
		if (value > best.value) best = {
			value,
			chosen
		};
	}
	return best.chosen.sort((a, b) => a.s - b.s).map((c) => ({
		id: `proposal-${c.assignationId}-${c.s}`,
		assignationId: c.assignationId,
		start: new Date(c.s),
		end: new Date(c.e),
		score: c.score
	}));
}
/** True when the candidate overlaps nothing and keeps the intercourse with every placed meeting. */
function fits(c, placed, gap) {
	for (const p of placed) {
		const g = gap(c.assignationId, p.assignationId) * 6e4;
		if (p.s < c.e + g && p.e + g > c.s) return false;
	}
	return true;
}
function construct(byConsumer, fixed, gap, noise) {
	const placed = [...fixed];
	const chosen = [];
	const order = [...byConsumer.entries()].map(([id, options]) => ({
		id,
		options,
		key: options.length * (1 + noise * Math.random())
	})).sort((a, b) => a.key - b.key);
	for (const { options } of order) {
		let pick = null;
		let pickScore = -Infinity;
		for (const c of options) {
			if (!fits(c, placed, gap)) continue;
			const sc = c.score + noise * Math.random();
			if (sc > pickScore) {
				pickScore = sc;
				pick = c;
			}
		}
		if (!pick) continue;
		chosen.push(pick);
		placed.push(pick);
	}
	return chosen;
}
function evaluate(chosen) {
	return new Set(chosen.map((c) => c.assignationId)).size * NEW_CONSUMER_BONUS + chosen.reduce((sum, c) => sum + c.score, 0);
}
//#endregion
//#region shared/recurrence.ts
var DAY_MS = 864e5;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var WEEKDAYS_FR = [
	"dimanche",
	"lundi",
	"mardi",
	"mercredi",
	"jeudi",
	"vendredi",
	"samedi"
];
var formatters = /* @__PURE__ */ new Map();
function formatter(timeZone) {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		});
		formatters.set(timeZone, f);
	}
	return f;
}
function isValidTimeZone(timeZone) {
	if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
	try {
		formatter(timeZone);
		return true;
	} catch {
		return false;
	}
}
/** Wall-clock parts of an instant in a time zone. */
function parts(ms, timeZone) {
	const p = {};
	for (const x of formatter(timeZone).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
	return {
		y: p.year,
		m: p.month,
		d: p.day,
		h: p.hour % 24,
		min: p.minute,
		s: p.second
	};
}
/** Offset (ms) of the time zone at an instant: local wall clock - UTC. */
function offset(ms, timeZone) {
	const p = parts(ms, timeZone);
	return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1e3) * 1e3;
}
/** Local date (YYYY-MM-DD) of an instant in a time zone. */
function localDate(ms, timeZone) {
	const p = parts(ms, timeZone);
	return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
/** Instant of a wall-clock time (date + minutes after midnight) in a time zone. */
function zonedTime(date, minutes, timeZone) {
	const [y, m, d] = date.split("-").map(Number);
	const guess = Date.UTC(y, m - 1, d, 0, minutes);
	return guess - offset(guess - offset(guess, timeZone), timeZone);
}
/** Days since 1970-01-01 of a YYYY-MM-DD date. */
var dayNumber = (date) => {
	const [y, m, d] = date.split("-").map(Number);
	return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
var fromDayNumber = (n) => (/* @__PURE__ */ new Date(n * DAY_MS)).toISOString().slice(0, 10);
/**
* Occurrences whose start is in [from, to), in chronological order.
* Cancellations are not applied here (the caller knows them).
*/
function occurrences(r, from, to) {
	if (!(to > from) || !isValidTimeZone(r.timeZone) || !DATE_RE.test(r.startsOn)) return [];
	const startsOn = dayNumber(r.startsOn);
	const anchor = startsOn + (r.weekday - (/* @__PURE__ */ new Date(startsOn * DAY_MS)).getUTCDay() + 7) % 7;
	const step = Math.max(1, r.intervalWeeks) * 7;
	const last = r.endsOn && DATE_RE.test(r.endsOn) ? dayNumber(r.endsOn) : Infinity;
	let day = Math.max(anchor, dayNumber(localDate(from, r.timeZone)) - 1);
	day = anchor + Math.ceil((day - anchor) / step) * step;
	const out = [];
	const lastDay = Math.min(last, dayNumber(localDate(to, r.timeZone)) + 1);
	for (; day <= lastDay; day += step) {
		const date = fromDayNumber(day);
		const start = zonedTime(date, r.startMinute, r.timeZone);
		if (start < from) continue;
		if (start >= to) break;
		out.push({
			date,
			start,
			end: start + r.durationMinutes * 6e4
		});
	}
	return out;
}
/** "Chaque lundi" / "Toutes les 2 semaines, le lundi" + time range. */
function describe(r) {
	const t = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
	const day = WEEKDAYS_FR[r.weekday] ?? "?";
	return `${r.intervalWeeks > 1 ? `Toutes les ${r.intervalWeeks} semaines, le ${day}` : `Chaque ${day}`}, ${t(r.startMinute)} – ${t(r.startMinute + r.durationMinutes)}`;
}
//#endregion
//#region client/src/domHandler.ts
/** Required role per page (null = public page). */
var PAGES = {
	main: null,
	"admin-welcome": null,
	"admin-login": null,
	"admin-signup": null,
	"admin-dashboard": "admin",
	"admin-companies": "admin",
	"admin-consumers": "admin",
	"admin-agents": "admin",
	"admin-rooms": "admin",
	"admin-packages": "admin",
	"admin-results": "admin",
	"agent-welcome": null,
	"agent-login": null,
	"agent-signup": null,
	"agent-dashboard": "agent",
	"agent-companies": "agent",
	"agent-consumers": "agent",
	"agent-agenda": "agent",
	"agent-habits": "agent",
	"agent-results": "agent",
	"agent-script": "agent",
	"consumer-welcome": null,
	"consumer-access": null,
	"consumer-dashboard": "consumer",
	"consumer-agenda": "consumer",
	"consumer-habits": "consumer"
};
/** Period wide enough to get every meeting, whatever its date (results pages). */
var ALL_FROM = "2000-01-01T00:00:00.000Z";
var ALL_TO = "2100-01-01T00:00:00.000Z";
/** Default percentage the company takes on the agent (same value as the server). */
var DEFAULT_SOCIETY_RATE = 28;
var HOME = {
	admin: "admin-dashboard",
	agent: "agent-dashboard",
	consumer: "consumer-dashboard"
};
var STATUS = {
	pending: "En attente",
	done: "Terminé",
	canceledBy: "Annulé"
};
var KIND = {
	meeting: "Rendez-vous",
	dispo: "Disponibilité",
	suggestion: "Suggestion",
	slot: "Créneau de l’agent",
	proposal: "Proposition"
};
/** The server reports minutes; the UI works in hours. */
var normRequest = (r) => ({
	...r,
	requestedHours: r.requestedHours ?? Math.round((r.requestedMinutes ?? 0) / 6) / 10,
	scheduledHours: r.scheduledHours ?? Math.round((r.scheduledMinutes ?? 0) / 6) / 10,
	remainingHours: r.remainingHours ?? (r.remainingMinutes != null ? Math.round(r.remainingMinutes / 6) / 10 : void 0)
});
/** Hours a request still asks for (meetings already booked are not counted). */
var remainingOf = (r) => r.remainingHours ?? Math.max(0, Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 10) / 10);
/** Starting point of the script editor (see USERSCRIPT_API.md). */
var SCRIPT_TEMPLATE = `// Called on every meeting event of your agenda: "new-meeting", "update-meeting", "cancel-meeting" or "valid-meeting".
// Documentation: USERSCRIPT_API.md. Only env and args exist here (no require, fetch, process...).
async function userscript(env, args) {
	const { event, consumers, pricings, societyCommission } = args;
	const meeting = event.meeting;
	const consumer = consumers[meeting.consumer];
	env.log(event.type, meeting.startAt, consumer.name, consumer.surname, meeting.agentAmount + " EUR");

	// Example: send the event to your own service, with a key stored in the secrets.
	// const res = await env.post("https://example.com/webhook", { type: event.type, meeting }, {
	// 	headers: { Authorization: "Bearer " + env.secrets.API_KEY },
	// });
	// env.log(res.status, res.body);
}
`;
var SCRIPT_EVENTS = {
	"new-meeting": "Nouveau rendez-vous",
	"update-meeting": "Rendez-vous modifié (salle, commentaire)",
	"cancel-meeting": "Rendez-vous annulé",
	"valid-meeting": "Rendez-vous validé (terminé)"
};
var RUN_STATUS = {
	ok: "Réussi",
	error: "Erreur",
	timeout: "Temps dépassé",
	skipped: "Ignoré"
};
/** Temporary id of a row created on screen before the server answered (real ids are positive). */
var tempId = () => -1 - Math.floor(Math.random() * 1e9);
/** Time zone of the browser: the repetitions keep their wall-clock time in it. */
var browserTimeZone = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
};
var hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Form of the "Répétition automatique" section. */
var newGenForm = () => {
	const today = /* @__PURE__ */ new Date();
	return {
		id: null,
		weekday: today.getDay(),
		start: "09:00",
		duration: 120,
		love: .5,
		intervalWeeks: 1,
		startsOn: localDate(today.getTime(), browserTimeZone()),
		endsOn: "",
		contractId: null
	};
};
var uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
var horizon = (days) => ({
	from: (/* @__PURE__ */ new Date()).toISOString(),
	to: addDays(/* @__PURE__ */ new Date(), days).toISOString()
});
var raw = new class DomHandler {
	constructor() {
		this.ready = false;
		this.page = "main";
		this.role = null;
		this.user = null;
		this.company = null;
		this.busy = false;
		this.loading = false;
		this.syncing = 0;
		this.error = "";
		this.notice = "";
		this.flash = "";
		this.form = {};
		this.created = null;
		this.companies = [];
		this.consumers = [];
		this.agents = [];
		this.rooms = [];
		this.results = [];
		this.meetings = [];
		this.contracts = [];
		this.assignations = [];
		this.suggestions = [];
		this.dispos = [];
		this.requests = [];
		this.slots = [];
		this.agentsList = [];
		this.selAssign = null;
		this.panel = null;
		this.showDispo = {};
		this.agentResults = [];
		this.searched = false;
		this.openAgent = null;
		this.packages = [];
		this.dragRoom = null;
		this.overRoom = null;
		this.roomCal = new Calendar();
		this.roomMeetings = [];
		this.assignDialog = {
			agent: null,
			q: "",
			fidelityId: "",
			error: ""
		};
		this.res = new ResultsView();
		this.onlyRequesters = false;
		this.intercoursePairs = [];
		this.openIntercourse = null;
		this.proposals = [];
		this.planForm = { maxMinutes: 120 };
		this.script = null;
		this.scriptCode = "";
		this.scriptRuns = [];
		this.scriptTest = {
			type: "new-meeting",
			meetingId: "",
			last: null
		};
		this.secretForm = {
			name: "",
			value: ""
		};
		this.openRun = null;
		this.generators = [];
		this.otherGenerators = [];
		this.habitCal = new HabitCalendar();
		this.habitToEdit = null;
		this.rangeLoaded = false;
		this.virtualDispos = [];
		this.virtualSuggestions = [];
		this.doneEdit = null;
		this.cal = new Calendar();
		this.agendaSeq = 0;
		this.loadedRange = "";
		this.syncChain = Promise.resolve();
		this.resyncWanted = false;
		this.lastButton = null;
	}
	/** Alpine looks methods up on own properties: bind them to the reactive proxy. */
	bindAll(self) {
		for (const k of Object.getOwnPropertyNames(DomHandler.prototype)) {
			const f = this[k];
			if (k !== "constructor" && k !== "bindAll" && typeof f === "function") this[k] = f.bind(self);
		}
	}
	async start() {
		fetcher.onUnauthorized = () => {
			this.clearSession();
			this.flash = "Votre session a expiré. Reconnectez-vous.";
			this.go("main");
		};
		window.addEventListener("hashchange", () => void this.route());
		document.addEventListener("click", (e) => {
			const el = e.target?.closest?.("button");
			this.lastButton = el ? {
				el,
				at: Date.now()
			} : null;
		}, true);
		module_default.directive("place", (el, { expression }, { evaluate, effect }) => {
			effect(() => {
				const vars = evaluate(expression);
				if (vars) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, String(v));
			});
		});
		module_default.data("app", () => dom);
		module_default.start();
		await this.restore();
		await this.route();
	}
	async restore() {
		if (!fetcher.token) return;
		try {
			const me = await fetcher.me();
			this.role = me.role;
			this.user = me.user;
			if (me.role === "admin") this.company = (await fetcher.companies())[0] ?? null;
		} catch {
			this.clearSession();
		}
	}
	startSession(role, r) {
		fetcher.setToken(r.token);
		this.role = role;
		this.user = r.user;
		this.company = r.company ?? null;
	}
	clearSession() {
		fetcher.setToken(null);
		this.role = null;
		this.user = null;
		this.company = null;
		this.meetings = [];
		this.consumers = [];
		this.agents = [];
		this.rooms = [];
		this.dispos = [];
		this.suggestions = [];
		this.slots = [];
		this.requests = [];
		this.agentsList = [];
		this.selAssign = null;
		this.assignations = [];
		this.showDispo = {};
		this.cal.events = [];
		this.packages = [];
		this.roomMeetings = [];
		this.res.clear();
		this.roomCal.events = [];
		this.onlyRequesters = false;
		this.intercoursePairs = [];
		this.openIntercourse = null;
		this.proposals = [];
		this.cal.gaps = [];
		this.script = null;
		this.scriptCode = "";
		this.scriptRuns = [];
		this.scriptTest = {
			type: "new-meeting",
			meetingId: "",
			last: null
		};
		this.generators = [];
		this.otherGenerators = [];
		this.habitCal.events = [];
		this.habitToEdit = null;
		this.virtualDispos = [];
		this.virtualSuggestions = [];
		this.rangeLoaded = false;
		this.loadedRange = "";
		this.doneEdit = null;
	}
	async logout() {
		try {
			await fetcher.logout();
		} catch {}
		this.clearSession();
		this.go("main");
	}
	go(page) {
		if (location.hash === `#${page}`) this.route();
		else location.hash = page;
	}
	async route() {
		const [raw, query = ""] = location.hash.replace(/^#\/?/, "").split("?", 2);
		const accessKey = raw === "consumer-welcome" ? (new URLSearchParams(query).get("key") ?? "").trim() : "";
		if (accessKey) return this.accessWithKey(accessKey);
		let page = Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : "main";
		const need = PAGES[page];
		if (need && this.role !== need) page = `${need}-welcome`;
		else if (!need && this.role && page.startsWith(`${this.role}-`)) page = HOME[this.role];
		if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
		this.page = page;
		this.form = {};
		this.created = null;
		this.panel = null;
		this.results = [];
		this.doneEdit = null;
		this.notice = "";
		this.error = this.flash;
		this.flash = "";
		this.ready = true;
		window.scrollTo(0, 0);
		await this.loadPage();
	}
	/** Opens the consumer space with the key of an access link; on failure the access form is shown, prefilled. */
	async accessWithKey(key) {
		history.replaceState(null, "", "#consumer-access");
		if (this.role) {
			try {
				await fetcher.logout();
			} catch {}
			this.clearSession();
		}
		try {
			this.startSession("consumer", await fetcher.consumerAccess(key));
			this.go(HOME.consumer);
		} catch (e) {
			this.flash = e?.message ?? "Clé d’accès invalide.";
			await this.route();
			this.form.key = key;
		}
	}
	async run(fn, ok = "") {
		if (this.busy) return;
		this.busy = true;
		this.error = "";
		this.notice = "";
		if (this.panel) this.panel.error = "";
		const button = this.lastButton && Date.now() - this.lastButton.at < 1e3 ? this.lastButton.el : null;
		button?.setAttribute("aria-busy", "true");
		try {
			await fn();
			if (ok) this.notice = ok;
		} catch (e) {
			const msg = e?.message ?? "Une erreur est survenue.";
			if (this.panel) this.panel.error = msg;
			else this.error = msg;
		} finally {
			this.busy = false;
			button?.removeAttribute("aria-busy");
		}
	}
	/**
	* Optimistic change, for what the browser can guess without the server: `apply` changes the screen at once and
	* returns how to undo it, `send` talks to the server in the background. Sends run one after the other, in order.
	* If the server refuses, the change is undone and the error shown. Once nothing is left to send, the page data is
	* reloaded quietly (no spinner) so the screen matches the server (remaining hours, generated rows…).
	*/
	optimistic(apply, send, ok = "") {
		this.error = "";
		this.notice = "";
		const page = this.page;
		const undo = apply();
		this.redraw();
		this.syncing += 1;
		const task = this.syncChain.then(send).then(() => {
			if (ok && this.page === page) this.notice = ok;
		}, (e) => {
			undo?.();
			if (this.page === page) this.error = e?.message ?? "Une erreur est survenue : la modification a été annulée.";
		}).finally(() => {
			this.syncing -= 1;
			this.resyncWanted = true;
			this.redraw();
			if (!this.syncing && this.resyncWanted && this.page === page) {
				this.resyncWanted = false;
				this.quietReload();
			}
		});
		this.syncChain = task;
		return task;
	}
	/** Rebuilds what is drawn from the data (the calendar is not reactive to the arrays it is built from). */
	redraw() {
		if (this.page === "agent-agenda" || this.page === "consumer-agenda") this.cal.events = this.buildEvents();
		if (this.page === "agent-habits" || this.page === "consumer-habits") this.habitCal.events = this.buildHabitEvents();
	}
	/** Reloads the data of the page without any spinner (after optimistic changes). */
	async quietReload() {
		try {
			if (this.page === "agent-agenda" || this.page === "consumer-agenda") await this.refreshAgenda(true);
			else if (this.page === "agent-habits" || this.page === "consumer-habits") await this.loadHabits();
			else if (this.page === "admin-results" || this.page === "agent-results") await this.reloadResults();
			else if (this.page === "admin-dashboard") {
				const { from, to } = horizon(14);
				this.meetings = (await fetcher.agenda(from, to)).meetings ?? [];
			}
		} catch {}
	}
	/** Runs synchronous checks of a form; the message goes to the panel (or the page) and false is returned. */
	check(fn) {
		this.error = "";
		if (this.panel) this.panel.error = "";
		try {
			fn();
			return true;
		} catch (e) {
			const msg = e?.message ?? "Valeur invalide.";
			if (this.panel) this.panel.error = msg;
			else this.error = msg;
			return false;
		}
	}
	async load(fn) {
		this.loading = true;
		this.error = "";
		try {
			await fn();
		} catch (e) {
			this.error = e?.message ?? "Chargement impossible.";
		} finally {
			this.loading = false;
		}
	}
	async loadPage() {
		const { from, to } = horizon(14);
		switch (this.page) {
			case "admin-dashboard": return this.load(async () => {
				const [a, c, ag, asg, rooms] = await Promise.all([
					fetcher.agenda(from, to),
					fetcher.consumers(),
					fetcher.agents(),
					fetcher.assignations(),
					fetcher.rooms()
				]);
				this.meetings = a.meetings ?? [];
				this.consumers = c;
				this.agents = ag;
				this.assignations = asg;
				this.rooms = rooms;
			});
			case "admin-companies":
			case "agent-companies": return this.load(async () => {
				this.companies = await fetcher.companies();
				if (this.role === "admin") this.form.societyRate = this.companies[0]?.societyRate ?? DEFAULT_SOCIETY_RATE;
			});
			case "admin-consumers": return this.load(async () => {
				[this.consumers, this.agents, this.packages] = await Promise.all([
					fetcher.consumers(),
					fetcher.agents(),
					fetcher.packages()
				]);
			});
			case "admin-agents":
				this.agentResults = [];
				this.searched = false;
				this.openAgent = null;
				return this.load(async () => {
					[this.consumers, this.agents, this.assignations, this.packages] = await Promise.all([
						fetcher.consumers(),
						fetcher.agents(),
						fetcher.assignations(),
						fetcher.packages()
					]);
				});
			case "admin-rooms":
				this.roomCal.settings = {
					...this.roomCal.settings,
					mode: "days",
					daysCount: 1
				};
				this.roomCal.onRange = () => void this.load(() => this.loadRoomCalendar());
				this.form = {
					...this.form,
					...this.roomPeriodDefaults()
				};
				return this.load(async () => {
					this.assignations = await fetcher.assignations();
					await this.loadRooms();
					await this.loadRoomCalendar();
				});
			case "admin-packages": return this.load(async () => {
				this.packages = await fetcher.packages();
			});
			case "admin-results": return this.load(async () => {
				const [a, asg] = await Promise.all([fetcher.agenda(ALL_FROM, ALL_TO), fetcher.assignations()]);
				this.res.setData("admin", a.meetings ?? [], asg);
			});
			case "agent-results": return this.load(async () => {
				const a = await fetcher.agenda(ALL_FROM, ALL_TO);
				this.res.setData("agent", a.meetings ?? [], a.assignations ?? []);
			});
			case "agent-consumers":
				this.openIntercourse = null;
				return this.load(async () => {
					[this.assignations, this.intercoursePairs] = await Promise.all([fetcher.myConsumers(), fetcher.intercoursePairs()]);
				});
			case "agent-dashboard": return this.load(async () => {
				const a = await fetcher.agenda(from, to);
				this.meetings = a.meetings ?? [];
				this.contracts = a.contracts ?? [];
				this.assignations = a.assignations ?? [];
				this.dispos = await fetcher.disponibilities({
					from,
					to
				});
			});
			case "consumer-dashboard": return this.load(async () => {
				const a = await fetcher.agenda(from, to);
				this.meetings = a.meetings ?? [];
				this.agentsList = a.agents ?? [];
				this.requests = (a.requests ?? []).map(normRequest);
			});
			case "agent-script":
				this.secretForm = {
					name: "",
					value: ""
				};
				this.openRun = null;
				this.scriptTest = {
					...this.scriptTest,
					last: null
				};
				return this.load(async () => {
					const [script, runs, agenda] = await Promise.all([
						fetcher.script(),
						fetcher.scriptRuns(),
						fetcher.agenda(ALL_FROM, ALL_TO)
					]);
					this.script = script;
					this.scriptCode = script.code || SCRIPT_TEMPLATE;
					this.scriptRuns = runs;
					this.meetings = (agenda.meetings ?? []).slice().sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
					this.assignations = agenda.assignations ?? [];
				});
			case "agent-habits":
			case "consumer-habits": return this.openHabits();
			case "agent-agenda":
			case "consumer-agenda": return this.openAgenda();
		}
	}
	fmt(iso) {
		return new Date(iso).toLocaleString("fr-FR", {
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit"
		});
	}
	statusLabel(s) {
		return STATUS[s] ?? s;
	}
	kindLabel(k) {
		return KIND[k];
	}
	roomOf(m) {
		return m.roomName ?? m.room ?? "Sans salle";
	}
	agentLabel(a) {
		return [a.name ?? a.agent?.name, a.surname ?? a.agent?.surname].filter(Boolean).join(" ") || "Agent";
	}
	assignId(a) {
		return a.assignationId ?? a.id;
	}
	/** listConsumersForCompany returns { consumer, fidelity }; search results are flat. */
	consumerOf(c) {
		return c.consumer ?? c;
	}
	/** Stable list key: wrapped records ({ consumer, fidelity }) have no top-level id. */
	consumerKey(c) {
		return this.consumerOf(c).id;
	}
	consumerLabel(c) {
		const x = this.consumerOf(c);
		return [x.name, x.surname].filter(Boolean).join(" ") || "Consommateur";
	}
	assignationsOf(a) {
		return this.assignations.filter((x) => (x.agentId ?? x.agent?.id) === a.id);
	}
	isShown(assignationId) {
		return this.showDispo[assignationId] !== false;
	}
	/**
	* A consumer is "requesting" when one of his requests is still open with hours left to schedule
	* (a request without limit counts: he wants meetings and nothing has capped them).
	*/
	isRequester(assignationId) {
		return this.requests.some((r) => r.assignationId === assignationId && (r.status ?? "open") === "open" && (r.remainingMinutes ?? Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 60)) > 0);
	}
	/** Consumers listed in the agent agenda: everybody, or only the requesting ones when "Demandeurs" is checked. */
	visibleAssignations() {
		return this.onlyRequesters ? this.assignations.filter((x) => this.isRequester(x.id)) : this.assignations;
	}
	/** True when the availabilities of this consumer are drawn in the agent agenda. */
	isVisible(assignationId) {
		return this.isShown(assignationId) && (!this.onlyRequesters || this.isRequester(assignationId));
	}
	toggleRequesters() {
		this.onlyRequesters = !this.onlyRequesters;
		this.cal.events = this.buildEvents();
	}
	toggleConsumer(assignationId) {
		this.showDispo = {
			...this.showDispo,
			[assignationId]: !this.isShown(assignationId)
		};
		this.cal.events = this.buildEvents();
	}
	/** "Tous": applies to the consumers currently listed (all of them, or only the requesting ones). */
	setAllConsumers(on) {
		const next = { ...this.showDispo };
		for (const x of this.visibleAssignations()) next[x.id] = on;
		this.showDispo = next;
		this.cal.events = this.buildEvents();
	}
	/** Agent: open the agenda showing only this consumer's availabilities. */
	showOnly(assignationId) {
		this.showDispo = Object.fromEntries(this.assignations.map((x) => [x.id, x.id === assignationId]));
		this.go("agent-agenda");
	}
	inCompany(a) {
		return this.agents.some((x) => x.id === a.id);
	}
	fidelityId(c) {
		return c.fidelityId ?? c.fidelity?.id;
	}
	fidelityKey(c) {
		return c.fidelityKey ?? c.fidelity?.key ?? "—";
	}
	copyConsumerLink(c) {
		const key = this.fidelityKey(c);
		if (!key || key === "—") {
			this.error = "Aucune clé d’accès disponible pour ce consommateur.";
			return;
		}
		const link = `${location.origin}${location.pathname}#consumer-welcome?key=${encodeURIComponent(key)}`;
		const done = () => {
			this.notice = `Lien d’accès de ${this.consumerLabel(c)} copié : ${link}`;
			this.error = "";
		};
		const fallback = () => {
			const area = document.createElement("textarea");
			area.value = link;
			document.body.append(area);
			area.select();
			const ok = document.execCommand("copy");
			area.remove();
			if (ok) done();
			else {
				this.notice = "";
				this.error = `Copie impossible, copiez le lien à la main : ${link}`;
			}
		};
		if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, fallback);
		else fallback();
	}
	/** An implicit request (hours not stated by the consumer) is created with this many hours. */
	isUnlimited(r) {
		return r.requestedHours >= 1e3;
	}
	progress(r) {
		const booked = `${r.scheduledHours ?? 0} h déjà planifiées`;
		return this.isUnlimited(r) ? `sans limite d’heures (${booked})` : `encore ${remainingOf(r)} h souhaitées (${booked})`;
	}
	remainingHours(r) {
		return remainingOf(r);
	}
	/**
	* Agent agenda: hours each consumer still wants (open requests), meetings already booked not counted.
	* `unlimited` when one of his open requests has no limit.
	*/
	consumerHours(assignationId) {
		const mine = this.requests.filter((r) => r.assignationId === assignationId);
		const open = mine.filter((r) => (r.status ?? "open") !== "closed");
		const round = (n) => Math.round(n * 10) / 10;
		return {
			remaining: round(open.filter((r) => !this.isUnlimited(r)).reduce((t, r) => t + remainingOf(r), 0)),
			scheduled: round(mine.reduce((t, r) => t + (r.scheduledHours ?? 0), 0)),
			unlimited: open.some((r) => this.isUnlimited(r))
		};
	}
	consumerHoursLabel(assignationId) {
		const h = this.consumerHours(assignationId);
		if (h.unlimited) return "sans limite";
		return h.remaining > 0 ? `${h.remaining} h` : "aucune";
	}
	upcoming() {
		return this.meetings.filter((m) => m.status === "pending").sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
	}
	/** Cancelled meetings of the visible range, oldest first (shown in a dedicated section). */
	cancelledMeetings() {
		return this.meetings.filter((m) => m.status === "canceledBy").sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
	}
	who(assignationId) {
		const a = this.assignations.find((x) => x.id === assignationId);
		return (a ? [a.consumer?.name, a.consumer?.surname].filter(Boolean).join(" ") : "") || `Consommateur n° ${assignationId}`;
	}
	contractLabel(c) {
		return c.companyName ?? c.company?.name ?? `Société n° ${c.companyId}`;
	}
	currentRequest() {
		const mine = this.requests.filter((r) => r.assignationId === this.selAssign);
		return mine.find((r) => remainingOf(r) > 0) ?? mine[0];
	}
	/** Assignation (agent + consumer) of a meeting, from the admin's assignation list. */
	assignationOf(m) {
		return this.assignations.find((x) => x.id === m.assignationId);
	}
	meetingAgent(m) {
		const a = this.assignationOf(m);
		return a ? this.agentLabel(a) : "—";
	}
	meetingConsumer(m) {
		const a = this.assignationOf(m);
		return a ? this.consumerLabel(a) : "—";
	}
	money(n) {
		return new Intl.NumberFormat("fr-FR", {
			style: "currency",
			currency: "EUR"
		}).format(n || 0);
	}
	packageLabel(p) {
		return `${p.name} (${this.money(p.hourlyRate)}/h)`;
	}
	packageById(id) {
		return id == null ? void 0 : this.packages.find((p) => p.id === id);
	}
	/** Highest number of simultaneous intervals inside [from, to). */
	peak(intervals, from, to) {
		const ev = [];
		for (const i of intervals) {
			const s = Math.max(from, i.s), e = Math.min(to, i.e);
			if (e > s) ev.push([s, 1], [e, -1]);
		}
		ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		let cur = 0, max = 0;
		for (const [, d] of ev) {
			cur += d;
			max = Math.max(max, cur);
		}
		return max;
	}
	/** True when the room cannot host this meeting (the server stays the final judge). */
	roomFull(r, m) {
		if (r.limit === -1 || m.roomName === r.name) return false;
		const s = Date.parse(m.startAt), e = s + m.durationMinutes * 6e4;
		const others = this.meetings.filter((x) => x.id !== m.id && x.status !== "canceledBy" && x.roomName === r.name).map((x) => ({
			s: Date.parse(x.startAt),
			e: Date.parse(x.startAt) + x.durationMinutes * 6e4
		}));
		return this.peak(others, s, e) >= r.limit;
	}
	/** Admin dashboard: give (or remove) the room of an upcoming meeting. */
	async setMeetingRoom(m, select) {
		const id = m.id, before = m.roomName ?? null, roomName = select.value || null;
		await this.optimistic(() => {
			this.meetings = this.meetings.map((x) => x.id === id ? {
				...x,
				roomName
			} : x);
			return () => {
				this.meetings = this.meetings.map((x) => x.id === id ? {
					...x,
					roomName: before
				} : x);
				select.value = before ?? "";
			};
		}, async () => {
			await fetcher.patchMeeting(id, { roomName });
		}, "Salle mise à jour.");
	}
	scriptEventLabel(t) {
		return SCRIPT_EVENTS[t] ?? t;
	}
	runStatusLabel(s) {
		return RUN_STATUS[s] ?? s;
	}
	scriptDirty() {
		return !!this.script && this.scriptCode !== (this.script.code || SCRIPT_TEMPLATE);
	}
	meetingOptionLabel(m) {
		const a = this.assignations.find((x) => x.id === m.assignationId);
		return `${this.fmt(m.startAt)} · ${a ? this.consumerLabel(a) : "Consommateur"} · ${this.statusLabel(m.status)}`;
	}
	/** Tab inserts a tab in the code editor instead of leaving it (Escape then Tab leaves it). */
	scriptTab(e) {
		if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
		const el = e.target;
		e.preventDefault();
		const { selectionStart: a, selectionEnd: b } = el;
		this.scriptCode = el.value.slice(0, a) + "	" + el.value.slice(b);
		requestAnimationFrame(() => {
			el.selectionStart = el.selectionEnd = a + 1;
		});
	}
	async saveScript() {
		await this.run(async () => {
			this.script = await fetcher.saveScript({ code: this.scriptCode });
		}, "Script enregistré.");
	}
	async toggleScript(enabled) {
		await this.run(async () => {
			this.script = await fetcher.saveScript(enabled ? {
				code: this.scriptCode,
				enabled
			} : { enabled });
		}, enabled ? "Script activé : il sera exécuté à chaque événement de rendez-vous." : "Script désactivé.");
	}
	resetScriptTemplate() {
		if (this.scriptCode.trim() && !confirm("Remplacer le code affiché par l’exemple ?")) return;
		this.scriptCode = SCRIPT_TEMPLATE;
	}
	async testScript() {
		await this.run(async () => {
			this.scriptTest.last = null;
			this.scriptTest.last = await fetcher.testScript({
				type: this.scriptTest.type,
				code: this.scriptCode,
				meetingId: this.scriptTest.meetingId ? Number(this.scriptTest.meetingId) : null
			});
			this.scriptRuns = await fetcher.scriptRuns();
		});
	}
	async refreshScriptRuns() {
		await this.load(async () => {
			this.scriptRuns = await fetcher.scriptRuns();
		});
	}
	async saveSecret() {
		const name = this.secretForm.name.trim();
		await this.run(async () => {
			if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error("Nom invalide : lettres, chiffres et _ uniquement, sans commencer par un chiffre (64 caractères au maximum).");
			const replaced = this.script?.secretNames.includes(name);
			this.script = await fetcher.updateSecrets([{
				name,
				value: this.secretForm.value
			}]);
			this.secretForm = {
				name: "",
				value: ""
			};
			this.notice = replaced ? `Secret « ${name} » remplacé.` : `Secret « ${name} » ajouté.`;
		});
	}
	async deleteSecret(name) {
		if (!confirm(`Supprimer le secret « ${name} » ?`)) return;
		await this.run(async () => {
			this.script = await fetcher.updateSecrets([{
				name,
				value: null
			}]);
		}, "Secret supprimé.");
	}
	async adminLogin() {
		await this.login("admin");
	}
	async agentLogin() {
		await this.login("agent");
	}
	async login(role) {
		await this.run(async () => {
			const f = this.form;
			const r = role === "admin" ? await fetcher.adminLogin(f.username ?? "", f.password ?? "") : await fetcher.agentLogin(f.username ?? "", f.password ?? "");
			this.startSession(role, r);
			this.go(HOME[role]);
		});
	}
	async adminSignup() {
		await this.run(async () => {
			const f = this.form;
			const r = await fetcher.adminSignup({
				username: f.username,
				password: f.password,
				displayName: f.displayName,
				companyName: f.companyName
			});
			this.startSession("admin", r);
			this.go(HOME.admin);
		});
	}
	async consumerAccess() {
		await this.run(async () => {
			const r = await fetcher.consumerAccess(String(this.form.key ?? "").trim(), this.form.password);
			this.startSession("consumer", r);
			this.go(HOME.consumer);
		});
	}
	async searchConsumers() {
		await this.run(async () => {
			this.results = await fetcher.searchConsumers(String(this.form.q ?? "").trim());
		});
	}
	async createConsumer() {
		await this.run(async () => {
			const f = this.form;
			this.created = await fetcher.createConsumer({
				name: f.name,
				surname: f.surname,
				username: f.username,
				password: f.password || void 0
			});
			this.form = {};
			this.consumers = await fetcher.consumers();
		}, "Consommateur créé et inscrit à votre société.");
	}
	async enroll(c) {
		await this.run(async () => {
			this.created = {
				consumer: c,
				fidelity: await fetcher.enrollConsumer(c.id)
			};
			this.results = [];
			this.consumers = await fetcher.consumers();
		}, "Consommateur inscrit à votre société.");
	}
	async createAgent() {
		await this.run(async () => {
			const f = this.form;
			await fetcher.createAgent({
				name: f.name,
				surname: f.surname,
				username: f.username,
				password: f.password
			});
			this.form = {};
			this.agents = await fetcher.agents();
		}, "Agent créé et rattaché à votre société.");
	}
	async searchAgents() {
		await this.run(async () => {
			this.agentResults = await fetcher.searchAgents(String(this.form.q ?? "").trim());
			this.searched = true;
		});
	}
	async attachAgent(a) {
		await this.run(async () => {
			await fetcher.attachAgent(a.id);
			this.agentResults = [];
			this.searched = false;
			this.agents = await fetcher.agents();
		}, "Agent rattaché à votre société.");
	}
	toggleAgent(a) {
		this.openAgent = this.openAgent === a.id ? null : a.id;
	}
	async removeAgent(a) {
		if (!confirm(`Retirer ${this.agentLabel(a)} de votre société ? Ses assignations seront supprimées.`)) return;
		await this.run(async () => {
			await fetcher.removeAgent(a.id);
			if (this.openAgent === a.id) this.openAgent = null;
			[this.agents, this.assignations] = await Promise.all([fetcher.agents(), fetcher.assignations()]);
		}, "Agent retiré de votre société.");
	}
	async removeAssignation(x) {
		if (!confirm(`Supprimer l’assignation de ${this.consumerLabel(x)} ?`)) return;
		await this.run(async () => {
			await fetcher.deleteAssignation(x.id);
			this.assignations = await fetcher.assignations();
		}, "Assignation supprimée.");
	}
	/** Opens the dialog used to attribute one more consumer to an agent. */
	openAssign(a) {
		this.assignDialog = {
			agent: a,
			q: "",
			fidelityId: "",
			error: ""
		};
		document.getElementById("assign-dialog")?.showModal();
	}
	closeAssign() {
		document.getElementById("assign-dialog")?.close();
		this.assignDialog.agent = null;
	}
	/** Consumers of the company that are not yet assigned to the chosen agent, filtered by the search text. */
	assignableConsumers() {
		const agent = this.assignDialog.agent;
		if (!agent) return [];
		const taken = new Set(this.assignationsOf(agent).map((x) => x.fidelityId));
		const q = this.assignDialog.q.trim().toLowerCase();
		return this.consumers.filter((c) => !taken.has(this.fidelityId(c)) && (!q || `${this.consumerLabel(c)} ${this.consumerOf(c).username}`.toLowerCase().includes(q)));
	}
	async confirmAssign() {
		const d = this.assignDialog;
		if (!d.agent || !d.fidelityId) return;
		await this.run(async () => {
			try {
				await fetcher.assign(d.agent.id, Number(d.fidelityId));
				this.assignations = await fetcher.assignations();
			} catch (e) {
				d.error = e?.message ?? "Assignation impossible.";
				return;
			}
			this.closeAssign();
		}, "Consommateur attribué à l’agent.");
	}
	async createPackage() {
		await this.run(async () => {
			const rate = Number(String(this.form.hourlyRate ?? "").replace(",", "."));
			if (!Number.isFinite(rate) || rate < 0) throw new Error("Le prix horaire doit être un nombre supérieur ou égal à 0.");
			await fetcher.createPackage(String(this.form.name ?? ""), rate);
			this.form = {};
			this.packages = await fetcher.packages();
		}, "Formule créée.");
	}
	async deletePackage(p) {
		if (!confirm(`Supprimer la formule « ${p.name} » ?`)) return;
		await this.run(async () => {
			await fetcher.deletePackage(p.id);
			this.packages = await fetcher.packages();
		}, "Formule supprimée.");
	}
	/** Default package id of a consumer row ({ consumer, fidelity }), or null when not defined. */
	defaultPackageId(c) {
		return c.fidelity?.defaultPackageId ?? null;
	}
	async setConsumerPackage(c, value) {
		await this.run(async () => {
			await fetcher.setConsumerPackage(this.fidelityId(c), value ? Number(value) : null);
			this.consumers = await fetcher.consumers();
		}, "Formule par défaut enregistrée.");
	}
	/** Text of the "default" option of an assignation: it shows the package the default would give. */
	defaultOptionLabel(x) {
		const c = this.consumers.find((k) => this.fidelityId(k) === x.fidelityId);
		const p = c ? this.packageById(this.defaultPackageId(c)) : void 0;
		return p ? `Par défaut (${this.packageLabel(p)})` : `Par défaut (aucune formule : ${this.money(0)})`;
	}
	async setAssignationPackage(x, value) {
		await this.run(async () => {
			await fetcher.setAssignationPackage(x.id, value ? Number(value) : null);
			this.assignations = await fetcher.assignations();
		}, "Prix horaire enregistré.");
	}
	async loadRooms() {
		this.rooms = (await fetcher.rooms()).map((r) => ({
			...r,
			draftName: r.name,
			draftLimit: r.limit
		}));
	}
	async createRoom() {
		await this.run(async () => {
			const limit = Number(this.form.limit ?? -1);
			if (!Number.isInteger(limit) || limit !== -1 && limit < 1) throw new Error("La limite vaut -1 (illimitée) ou un entier positif.");
			await fetcher.createRoom(String(this.form.name ?? ""), limit);
			this.form = {
				autoFrom: this.form.autoFrom,
				autoTo: this.form.autoTo
			};
			await this.loadRooms();
		}, "Salle créée.");
	}
	/** Single "Enregistrer" button: names, limits and the order of every room are saved together, atomically. */
	async saveRooms() {
		await this.run(async () => {
			const items = this.rooms.map((r) => {
				const limit = Number(r.draftLimit);
				if (!Number.isInteger(limit) || limit !== -1 && limit < 1) throw new Error(`La limite de « ${r.name} » vaut -1 (illimitée) ou un entier positif.`);
				const newName = (r.draftName ?? "").trim();
				return {
					name: r.name,
					newName: newName && newName !== r.name ? newName : void 0,
					limit
				};
			});
			await fetcher.saveRooms(items);
			await this.loadRooms();
			await this.loadRoomCalendar();
		}, "Salles enregistrées.");
	}
	moveRoom(from, to) {
		if (from === to || from < 0 || to < 0 || from >= this.rooms.length || to >= this.rooms.length) return;
		const list = [...this.rooms];
		const [item] = list.splice(from, 1);
		list.splice(to, 0, item);
		this.rooms = list;
	}
	roomDragStart(e, index) {
		this.dragRoom = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", String(index));
			const row = e.target.closest("tr");
			if (row) e.dataTransfer.setDragImage(row, 0, 0);
		}
	}
	roomDragOver(e, index) {
		if (this.dragRoom === null) return;
		e.preventDefault();
		this.overRoom = index;
	}
	roomDrop(e, index) {
		e.preventDefault();
		if (this.dragRoom !== null) this.moveRoom(this.dragRoom, index);
		this.roomDragEnd();
	}
	roomDragEnd() {
		this.dragRoom = null;
		this.overRoom = null;
	}
	async loadRoomCalendar() {
		const { from, to } = this.roomCal.range;
		const a = await fetcher.agenda(from, to);
		this.roomMeetings = (a.meetings ?? []).filter((m) => m.status !== "canceledBy");
		this.roomCal.events = this.roomMeetings.map((m) => ({
			id: `room-${m.id}`,
			kind: "meeting",
			title: `${this.meetingAgent(m)} · ${this.meetingConsumer(m)}`,
			status: m.status,
			raw: m,
			start: new Date(m.startAt),
			end: new Date(Date.parse(m.startAt) + m.durationMinutes * 6e4)
		}));
	}
	/** Columns of the room calendar: the active rooms in their order, then the meetings that have no room. */
	roomColumns() {
		return [...this.rooms.map((r) => ({
			key: r.name,
			label: r.name,
			name: r.name
		})), {
			key: "(none)",
			label: "Sans salle",
			name: null
		}];
	}
	roomColumnEvents(name) {
		const events = this.roomCal.events.filter((e) => (e.raw.roomName ?? null) === name);
		return this.roomCal.layout(events, this.roomCal.first);
	}
	/** Visible hours of the room calendar (kept in memory only, so the agent agenda settings are not touched). */
	applyRoomHours() {
		const s = this.roomCal.settings;
		s.startHour = Math.min(22, Math.max(0, Math.round(Number(s.startHour)) || 0));
		s.endHour = Math.min(24, Math.max(s.startHour + 1, Math.round(Number(s.endHour)) || 24));
	}
	/** Default period of the automatic room assignment: today, from 7:00 to 22:00. */
	roomPeriodDefaults() {
		const from = /* @__PURE__ */ new Date();
		from.setHours(7, 0, 0, 0);
		const to = /* @__PURE__ */ new Date();
		to.setHours(22, 0, 0, 0);
		return {
			autoFrom: toLocalInput(from),
			autoTo: toLocalInput(to)
		};
	}
	/** Automatic room assignment over the period typed in the form. */
	async autoAssignRooms() {
		await this.run(async () => {
			const from = new Date(String(this.form.autoFrom ?? ""));
			const to = new Date(String(this.form.autoTo ?? ""));
			if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Indiquez le début et la fin de la période.");
			if (to.getTime() <= from.getTime()) throw new Error("La fin de la période doit être après son début.");
			const r = await fetcher.autoAssignRooms(from.toISOString(), to.toISOString());
			this.roomCal.anchor = from;
			await this.loadRoomCalendar();
			const n = r.assigned.length, k = r.unassigned.length;
			this.notice = n + (n > 1 ? " rendez-vous ont reçu une salle." : " rendez-vous a reçu une salle.") + (k ? ` ${k} n’${k > 1 ? "ont" : "a"} pas pu en recevoir (aucune salle assez grande de libre).` : "");
		});
	}
	hoursLabel(h) {
		return `${Math.round(h * 100) / 100} h`;
	}
	async reloadResults() {
		const a = await fetcher.agenda(ALL_FROM, ALL_TO);
		this.res.setData(this.res.mode, a.meetings ?? [], this.res.assignations);
	}
	/** Changes one meeting of the results on screen; returns how to undo it. */
	patchResult(id, change) {
		const before = this.res.meetings.find((m) => m.id === id);
		this.res.setData(this.res.mode, this.res.meetings.map((m) => m.id === id ? {
			...m,
			...change
		} : m), this.res.assignations);
		return () => {
			if (before) this.res.setData(this.res.mode, this.res.meetings.map((m) => m.id === id ? before : m), this.res.assignations);
		};
	}
	/** The only changes allowed from the results: validate (with the duration really spent), cancel or comment a pending meeting. */
	resultDone(id) {
		const m = this.res.meetings.find((x) => x.id === id);
		this.doneEdit = {
			id,
			minutes: m?.durationMinutes ?? 60
		};
	}
	async resultConfirmDone() {
		const edit = this.doneEdit;
		if (!edit) return;
		const minutes = Number(edit.minutes);
		if (!this.check(() => {
			if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("La durée réelle est un nombre entier de minutes, supérieur à 0.");
		})) return;
		this.doneEdit = null;
		const actual = minutes === this.res.meetings.find((x) => x.id === edit.id)?.durationMinutes ? null : minutes;
		await this.optimistic(() => this.patchResult(edit.id, {
			status: "done",
			actualDurationMinutes: actual
		}), async () => {
			await fetcher.patchMeeting(edit.id, {
				status: "done",
				actualDurationMinutes: actual
			});
		}, "Rendez-vous marqué comme terminé.");
	}
	async resultCancel(id) {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		await this.optimistic(() => this.patchResult(id, { status: "canceledBy" }), async () => {
			await fetcher.cancelMeeting(id);
		}, "Rendez-vous annulé.");
	}
	async resultComment(id, text) {
		await this.optimistic(() => this.patchResult(id, { comment: text }), async () => {
			await fetcher.patchMeeting(id, { comment: text });
		}, "Commentaire enregistré.");
	}
	/** Example shown under the field: what a 32 EUR price becomes for the agent and for the company. */
	societyExample() {
		const rate = Number(String(this.form.societyRate ?? "").replace(",", "."));
		if (!Number.isFinite(rate) || rate < 0) return "";
		const price = 32;
		const agent = Math.round(price / (1 + rate / 100) * 100) / 100;
		const society = Math.round((price - agent) * 100) / 100;
		return `Exemple : si une formule coûte ${this.money(price)}, l’agent reçoit ${this.money(agent)} et la société ${this.money(society)}.`;
	}
	async saveSocietyRate() {
		await this.run(async () => {
			const rate = Number(String(this.form.societyRate ?? "").replace(",", "."));
			if (!Number.isFinite(rate) || rate < 0 || rate > 1e3) throw new Error("Le taux doit être un nombre entre 0 et 1000 (en pourcentage).");
			const c = await fetcher.updateSocietyRate(rate);
			if (this.company) this.company = {
				...this.company,
				...c
			};
			this.companies = await fetcher.companies();
			this.form.societyRate = this.companies[0]?.societyRate ?? rate;
		}, "Taux de la société enregistré.");
	}
	async deactivateRoom(r) {
		if (!confirm(`Désactiver la salle « ${r.name} » ?`)) return;
		await this.run(async () => {
			await fetcher.deactivateRoom(r.name);
			await this.loadRooms();
		}, "Salle désactivée.");
	}
	async openAgenda() {
		this.cal.onSelect = (s, e, origin) => this.beginInterval(s, e, origin);
		this.cal.selection = null;
		this.cal.attach(() => void this.refreshAgenda());
		await this.refreshAgenda();
	}
	/**
	* Loads the visible period. Until the answer arrives, the period is drawn from the generators already known
	* (weekly repetitions), so changing week shows the usual hours at once. `silent` reloads without the spinner.
	*/
	async refreshAgenda(silent = false) {
		const { from, to } = this.cal.range;
		const key = `${this.selAssign}|${from}|${to}`;
		const seq = ++this.agendaSeq;
		if (key !== this.loadedRange) {
			this.rangeLoaded = false;
			this.cal.events = this.buildEvents();
		}
		const work = async () => {
			const a = await fetcher.agenda(from, to);
			if (seq !== this.agendaSeq) return;
			const meetings = a.meetings ?? [];
			let dispos = [];
			if (this.role === "agent") {
				let rooms;
				[dispos, rooms] = await Promise.all([fetcher.disponibilities({
					from,
					to
				}), fetcher.rooms()]);
				if (seq !== this.agendaSeq) return;
				this.contracts = a.contracts ?? [];
				this.assignations = a.assignations ?? [];
				this.suggestions = a.suggestions ?? [];
				this.requests = (a.requests ?? []).map(normRequest);
				this.intercoursePairs = a.intercoursePairs ?? [];
				this.generators = a.generators ?? [];
				this.otherGenerators = a.consumerGenerators ?? [];
				this.rooms = rooms;
			} else {
				this.agentsList = a.agents ?? [];
				this.requests = (a.requests ?? []).map(normRequest);
				this.slots = a.agentSlots ?? [];
				this.generators = a.generators ?? [];
				this.otherGenerators = a.agentGenerators ?? [];
				if (this.selAssign === null && this.agentsList.length) this.selAssign = this.assignId(this.agentsList[0]);
				dispos = this.selAssign ? await fetcher.disponibilities({
					assignationId: this.selAssign,
					from,
					to
				}) : [];
				if (seq !== this.agendaSeq) return;
			}
			this.meetings = meetings;
			this.dispos = dispos;
			this.loadedRange = `${this.selAssign}|${from}|${to}`;
			this.rangeLoaded = true;
			this.cal.events = this.buildEvents();
		};
		if (!silent) return this.load(work);
		try {
			await work();
		} catch {}
	}
	/** Agent of one of my assignations (consumer side). */
	agentOf(assignationId) {
		const a = this.agentsList.find((x) => this.assignId(x) === assignationId);
		return a ? this.agentLabel(a) : "Agent";
	}
	/**
	* Calendar events. The title is the other person (the consumer for the agent, the agent for the consumer).
	* Meetings no longer consume availabilities and suggestions on the server: they are only cut out of them here,
	* so an interval is drawn as the pieces left around the meetings.
	*/
	buildEvents() {
		const span = (x) => ({
			s: Date.parse(x.startAt),
			e: Date.parse(x.startAt) + x.durationMinutes * 6e4
		});
		this.buildVirtual();
		const { from, to } = this.cal.range;
		const inRange = (x) => {
			const { s, e } = span(x);
			return e > Date.parse(from) && s < Date.parse(to);
		};
		const meetings = this.meetings.filter((m) => m.status !== "canceledBy" && (this.rangeLoaded || inRange(m)));
		this.cal.gaps = this.role === "agent" ? this.buildGaps(meetings) : [];
		const busy = meetings.map(span).sort((a, b) => a.s - b.s);
		const mk = (kind, x, title, editable = false, status, s = span(x).s, e = span(x).e) => ({
			id: `${kind}-${x.id}-${s}`,
			kind,
			title,
			status,
			editable: editable && !x._pending && !x.virtual,
			love: x.love,
			raw: x,
			start: new Date(s),
			end: new Date(e),
			virtual: !!x.virtual,
			pending: !!x._pending
		});
		const cut = (kind, x, title, editable = false) => {
			const out = [];
			let { s, e } = span(x);
			for (const b of busy) {
				if (b.e <= s || b.s >= e) continue;
				if (b.s > s) out.push(mk(kind, x, title, editable, void 0, s, b.s));
				s = Math.max(s, b.e);
			}
			if (e > s) out.push(mk(kind, x, title, editable, void 0, s, e));
			return out;
		};
		const out = [];
		const agent = this.role === "agent";
		const rows = (list) => this.rangeLoaded ? list : list.filter((x) => x._pending);
		for (const m of meetings) out.push(mk("meeting", m, agent ? this.who(m.assignationId) : this.agentOf(m.assignationId), false, m.status));
		if (agent) {
			for (const p of this.proposals) out.push({
				id: p.id,
				kind: "proposal",
				title: this.who(p.assignationId),
				raw: p,
				start: p.start,
				end: p.end
			});
			for (const s of [...rows(this.suggestions), ...this.virtualSuggestions]) out.push(...cut("suggestion", s, "Mes horaires", true));
			for (const d of [...rows(this.dispos), ...this.virtualDispos]) if (this.isVisible(d.assignationId)) out.push(...cut("dispo", d, this.who(d.assignationId)));
		} else {
			for (const s of [...rows(this.slots), ...this.virtualSuggestions]) {
				const target = s.assignationId;
				if (this.selAssign !== null && target !== void 0 && target !== this.selAssign) continue;
				out.push(...cut("slot", s, this.agentOf(target ?? this.selAssign)));
			}
			for (const d of [...rows(this.dispos), ...this.virtualDispos]) out.push(...cut("dispo", d, "Ma disponibilité", true));
		}
		return out;
	}
	/**
	* Occurrences of the generators in the visible period that are not real rows: the ones after the period the
	* server already generated (two weeks), or every one while the period is loading. Cancelled ones are skipped.
	*/
	buildVirtual() {
		const { from, to } = this.cal.range;
		const now = Date.now();
		const lo = Math.max(Date.parse(from), now);
		const hi = Date.parse(to);
		const rowsOf = (g) => g.kind === "suggestion" ? this.role === "agent" ? this.suggestions : this.slots : this.dispos;
		const make = (g, assignationId) => {
			if (hi <= lo) return [];
			const cancelled = new Set(g.cancellations);
			const generated = Date.parse(g.generatedUntil);
			const real = new Set(rowsOf(g).filter((r) => r.generatorId === g.id).map((r) => r.generatorOccurrence));
			return occurrences(g, lo, hi).filter((o) => !cancelled.has(o.date) && !real.has(o.date) && (!this.rangeLoaded || o.start >= generated)).map((o) => ({
				id: `g${g.id}-${o.date}`,
				virtual: true,
				_pending: g._pending,
				generatorId: g.id,
				generatorOccurrence: o.date,
				startAt: new Date(o.start).toISOString(),
				durationMinutes: g.durationMinutes,
				love: g.love,
				contractId: g.contractId,
				assignationId,
				requestId: g.requestId ?? null
			}));
		};
		if (this.role === "agent") {
			this.virtualSuggestions = this.generators.flatMap((g) => make(g, null));
			this.virtualDispos = this.otherGenerators.flatMap((g) => make(g, g.assignationId));
		} else {
			this.virtualDispos = this.generators.filter((g) => g.assignationId === this.selAssign).flatMap((g) => make(g, g.assignationId));
			this.virtualSuggestions = this.otherGenerators.filter((g) => g.assignationId === this.selAssign).flatMap((g) => make(g, g.assignationId));
		}
	}
	generatorOf(id) {
		return id == null ? void 0 : [...this.generators, ...this.otherGenerators].find((g) => g.id === id);
	}
	describeGenerator(g) {
		return g ? describe(g) : "";
	}
	weekdayLabel(n) {
		return WEEKDAYS_FR[n] ?? "";
	}
	weekdays() {
		return [
			1,
			2,
			3,
			4,
			5,
			6,
			0
		].map((value) => ({
			value,
			label: WEEKDAYS_FR[value]
		}));
	}
	/** My generators shown in the section: the consumer only sees those of the agent selected. */
	myGenerators() {
		return this.role === "consumer" ? this.generators.filter((g) => g.assignationId === this.selAssign) : this.generators;
	}
	/** Period of a generator, for the list ("depuis le …, jusqu'au …"). */
	generatorPeriod(g) {
		const f = (d) => (/* @__PURE__ */ new Date(`${d}T12:00`)).toLocaleDateString("fr-FR", {
			day: "numeric",
			month: "short",
			year: "numeric"
		});
		const tz = g.timeZone !== browserTimeZone() ? ` (heure de ${g.timeZone})` : "";
		return `à partir du ${f(g.startsOn)}${g.endsOn ? `, jusqu’au ${f(g.endsOn)}` : ""}${tz}`;
	}
	/** Cancelled occurrences still to come (the past ones do not matter any more). */
	futureCancellations(g) {
		const today = localDate(Date.now(), g.timeZone);
		return g.cancellations.filter((d) => d >= today);
	}
	occurrenceLabel(date) {
		return (/* @__PURE__ */ new Date(`${date}T12:00`)).toLocaleDateString("fr-FR", {
			weekday: "short",
			day: "numeric",
			month: "short"
		});
	}
	/** From the agenda: opens the habit in the "Habitudes" page. */
	editGenerator(g) {
		this.closePanel();
		if (this.page.endsWith("-habits")) return this.openHabit(g);
		this.habitToEdit = g.id;
		this.go(this.role === "agent" ? "agent-habits" : "consumer-habits");
	}
	async openHabits() {
		this.habitCal.onSelect = (s, e) => this.newHabit(s, e);
		this.habitCal.selection = null;
		this.habitCal.attach(() => {
			this.habitCal.events = this.buildHabitEvents();
		});
		await this.load(() => this.loadHabits());
		const id = this.habitToEdit;
		this.habitToEdit = null;
		const g = this.generators.find((x) => x.id === id);
		if (g) this.openHabit(g);
	}
	/** The habits come with the agenda; a one-minute period is enough (no row is needed here). */
	async loadHabits() {
		const now = /* @__PURE__ */ new Date();
		const a = await fetcher.agenda(now.toISOString(), new Date(now.getTime() + 6e4).toISOString());
		this.requests = (a.requests ?? []).map(normRequest);
		this.generators = a.generators ?? [];
		if (this.role === "agent") {
			this.contracts = a.contracts ?? [];
			this.assignations = a.assignations ?? [];
			this.otherGenerators = a.consumerGenerators ?? [];
		} else {
			this.agentsList = a.agents ?? [];
			this.otherGenerators = a.agentGenerators ?? [];
			if (this.selAssign === null && this.agentsList.length) this.selAssign = this.assignId(this.agentsList[0]);
		}
		this.habitCal.events = this.buildHabitEvents();
	}
	/**
	* One block per habit, on the column of its weekday. Mine can be edited; the other side's are shown for reference
	* (the agent sees his consumers' habits, filtered like in the agenda; the consumer sees his agent's hours).
	*/
	buildHabitEvents() {
		const days = this.habitCal.days;
		const out = [];
		const add = (g, kind, title, editable) => {
			for (const day of days.filter((d) => d.getDay() === g.weekday)) {
				const start = new Date(day);
				start.setHours(0, g.startMinute, 0, 0);
				const every = g.intervalWeeks > 1 ? ` · toutes les ${g.intervalWeeks} sem.` : "";
				out.push({
					id: `habit-${g.id}-${day.getDay()}`,
					kind,
					title: title + every,
					love: g.love,
					editable,
					raw: g,
					start,
					end: new Date(start.getTime() + g.durationMinutes * 6e4),
					pending: !!g._pending
				});
			}
		};
		if (this.role === "agent") {
			for (const g of this.generators) add(g, "suggestion", "Mes horaires", true);
			for (const g of this.otherGenerators) if (g.assignationId !== null && this.isVisible(g.assignationId)) add(g, "dispo", this.who(g.assignationId), false);
		} else {
			for (const g of this.myGenerators()) add(g, "dispo", "Ma disponibilité", true);
			for (const g of this.otherGenerators) if (g.assignationId === this.selAssign) add(g, "slot", this.agentOf(g.assignationId), false);
		}
		return out;
	}
	/** A slot drawn on the week template: new habit on that weekday, at that time. */
	newHabit(start, end) {
		if (this.role === "consumer" && this.selAssign === null) {
			this.habitCal.selection = null;
			this.error = "Aucun agent ne vous est assigné.";
			return;
		}
		if (this.role === "agent" && !this.contracts.length) {
			this.habitCal.selection = null;
			this.error = "Aucun contrat actif : demandez à votre administrateur.";
			return;
		}
		this.error = "";
		this.panel = {
			type: "habit",
			error: "",
			gen: null,
			form: {
				...newGenForm(),
				weekday: start.getDay(),
				start: hhmm(start.getHours() * 60 + start.getMinutes()),
				duration: Math.max(15, Math.round((end.getTime() - start.getTime()) / 6e4)),
				contractId: this.contracts[0]?.id ?? null
			}
		};
	}
	/** Keyboard / touch fallback: a new habit today at 9:00. */
	openNewHabit() {
		const s = /* @__PURE__ */ new Date();
		s.setHours(9, 0, 0, 0);
		this.newHabit(s, new Date(s.getTime() + 2 * 36e5));
	}
	openHabitEvent(ev) {
		if (ev.pending) {
			this.error = "Enregistrement en cours… réessayez dans un instant.";
			return;
		}
		if (!ev.editable) {
			this.panel = {
				type: "habit-info",
				ev,
				error: ""
			};
			return;
		}
		this.openHabit(ev.raw);
	}
	openHabit(g) {
		this.error = "";
		this.panel = {
			type: "habit",
			error: "",
			gen: g,
			form: {
				id: g.id,
				weekday: g.weekday,
				start: hhmm(g.startMinute),
				duration: g.durationMinutes,
				love: g.love ?? .5,
				intervalWeeks: g.intervalWeeks,
				startsOn: g.startsOn,
				endsOn: g.endsOn ?? "",
				contractId: g.contractId
			}
		};
	}
	async submitHabit() {
		const form = this.panel.form;
		let ok = false;
		this.check(() => {
			this.generatorBody(form);
			ok = true;
		});
		if (!ok) return;
		this.closePanel();
		await this.saveGenerator(form);
	}
	generatorBody(f) {
		const [h, m] = String(f.start).split(":").map(Number);
		const duration = Number(f.duration), love = Number(f.love), interval = Number(f.intervalWeeks);
		if (!Number.isInteger(h) || !Number.isInteger(m)) throw new Error("L’heure de début est invalide.");
		if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) throw new Error("La durée est un nombre entier de minutes, 24 h au plus.");
		if (!(love >= 0 && love <= 1)) throw new Error("La préférence doit être comprise entre 0 et 1.");
		if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw new Error("La fréquence est comprise entre 1 et 52 semaines.");
		if (!f.startsOn) throw new Error("Indiquez la date de début.");
		if (f.endsOn && f.endsOn < f.startsOn) throw new Error("La date de fin doit être après la date de début.");
		const body = {
			weekday: Number(f.weekday),
			startMinute: h * 60 + m,
			durationMinutes: duration,
			love,
			intervalWeeks: interval,
			timeZone: browserTimeZone(),
			startsOn: f.startsOn,
			endsOn: f.endsOn || null
		};
		if (this.role === "agent") {
			const contractId = Number(f.contractId ?? this.contracts[0]?.id);
			if (!contractId) throw new Error("Aucun contrat actif : demandez à votre administrateur.");
			body.contractId = contractId;
		} else {
			if (this.selAssign === null) throw new Error("Aucun agent ne vous est assigné.");
			body.assignationId = this.selAssign;
			const request = this.currentRequest();
			if (request) body.requestId = request.id;
		}
		return body;
	}
	/** Rows generated by a generator that are still to come (removed by the server when the rule changes). */
	dropFutureRows(id) {
		const now = Date.now();
		const keep = (r) => r.generatorId !== id || Date.parse(r.startAt) <= now;
		const before = {
			dispos: this.dispos,
			suggestions: this.suggestions
		};
		this.dispos = this.dispos.filter(keep);
		this.suggestions = this.suggestions.filter(keep);
		return () => {
			this.dispos = before.dispos;
			this.suggestions = before.suggestions;
		};
	}
	/** Creates or changes a habit (generator), from the "Habitudes" page or the "repeat" box of the agenda. */
	async saveGenerator(form) {
		let body;
		if (!this.check(() => {
			body = this.generatorBody(form);
		})) return;
		const id = form.id;
		const local = (base = {}) => ({
			...base,
			id: id ?? tempId(),
			kind: this.role === "agent" ? "suggestion" : "disponibility",
			contractId: body.contractId ?? null,
			assignationId: body.assignationId ?? null,
			requestId: body.requestId ?? null,
			weekday: body.weekday,
			startMinute: body.startMinute,
			durationMinutes: body.durationMinutes,
			love: body.love,
			intervalWeeks: body.intervalWeeks,
			timeZone: body.timeZone,
			startsOn: body.startsOn,
			endsOn: body.endsOn,
			generatedUntil: (/* @__PURE__ */ new Date()).toISOString(),
			cancellations: base.cancellations ?? [],
			_pending: true
		});
		if (id === null) {
			const tmp = local();
			await this.optimistic(() => {
				this.generators = [...this.generators, tmp];
				return () => {
					this.generators = this.generators.filter((g) => g.id !== tmp.id);
				};
			}, async () => {
				const saved = await fetcher.createGenerator(body);
				this.generators = this.generators.map((g) => g.id === tmp.id ? {
					...saved,
					generatedUntil: tmp.generatedUntil
				} : g);
			}, "Habitude enregistrée : le créneau apparaît chaque semaine dans l’agenda.");
			return;
		}
		const before = this.generators.find((g) => g.id === id);
		await this.optimistic(() => {
			this.generators = this.generators.map((g) => g.id === id ? local(g) : g);
			const restoreRows = this.dropFutureRows(id);
			return () => {
				restoreRows();
				if (before) this.generators = this.generators.map((g) => g.id === id ? before : g);
			};
		}, async () => {
			const saved = await fetcher.updateGenerator(id, body);
			this.generators = this.generators.map((g) => g.id === id ? {
				...saved,
				generatedUntil: (/* @__PURE__ */ new Date()).toISOString()
			} : g);
		}, "Habitude modifiée.");
	}
	async deleteGenerator(g) {
		if (!confirm(`Supprimer l’habitude « ${describe(g)} » ? Les créneaux à venir qu’elle a créés seront supprimés.`)) return;
		const id = g.id;
		this.closePanel();
		const before = this.generators;
		await this.optimistic(() => {
			this.generators = this.generators.filter((x) => x.id !== id);
			const restoreRows = this.dropFutureRows(id);
			return () => {
				restoreRows();
				this.generators = before;
			};
		}, async () => {
			await fetcher.deleteGenerator(id);
		}, "Habitude supprimée.");
	}
	/** Changes the cancellations of a generator on screen; returns how to undo it. */
	setCancellations(id, change) {
		const before = this.generators.find((g) => g.id === id);
		this.generators = this.generators.map((g) => g.id === id ? {
			...g,
			cancellations: change(g.cancellations)
		} : g);
		return () => {
			if (before) this.generators = this.generators.map((g) => g.id === id ? before : g);
		};
	}
	/** "Cancelator": this occurrence of the repetition will not happen (removed if it was already created). */
	async cancelOccurrence(generatorId, date) {
		this.closePanel();
		await this.optimistic(() => {
			const undo = this.setCancellations(generatorId, (d) => [.../* @__PURE__ */ new Set([...d, date])]);
			const keep = (r) => !(r.generatorId === generatorId && r.generatorOccurrence === date);
			const before = {
				dispos: this.dispos,
				suggestions: this.suggestions
			};
			this.dispos = this.dispos.filter(keep);
			this.suggestions = this.suggestions.filter(keep);
			return () => {
				undo();
				this.dispos = before.dispos;
				this.suggestions = before.suggestions;
			};
		}, async () => {
			await fetcher.cancelOccurrence(generatorId, date);
		}, "Occurrence annulée.");
	}
	async restoreOccurrence(generatorId, date) {
		await this.optimistic(() => this.setCancellations(generatorId, (d) => d.filter((x) => x !== date)), async () => {
			await fetcher.restoreOccurrence(generatorId, date);
		}, "Occurrence rétablie.");
	}
	/** Default intercourse of a consumer (minutes). */
	intercourseOf(assignationId) {
		return this.assignations.find((x) => x.id === assignationId)?.intercourseMinutes ?? 0;
	}
	/** Value chosen for a pair of consumers (order does not matter), or null. */
	pairIntercourse(a, b) {
		const p = this.intercoursePairs.find((x) => x.assignationA === a && x.assignationB === b || x.assignationA === b && x.assignationB === a);
		return p ? p.minutes : null;
	}
	/** Minutes required between meetings of two consumers: the pair value, else the larger default. */
	gap(a, b) {
		return (a !== b ? this.pairIntercourse(a, b) : null) ?? Math.max(this.intercourseOf(a), this.intercourseOf(b));
	}
	toggleIntercourse(x) {
		this.openIntercourse = this.openIntercourse === x.id ? null : x.id;
	}
	intercourseInput(value) {
		const n = Number(String(value).trim());
		if (!Number.isInteger(n) || n < 0 || n > 1440) throw new Error("L’intercours est un nombre entier de minutes entre 0 et 1440.");
		return n;
	}
	async saveIntercourse(x, value) {
		await this.run(async () => {
			await fetcher.setIntercourse(x.id, this.intercourseInput(value || "0"));
			this.assignations = await fetcher.myConsumers();
		}, `Intercours de ${this.consumerLabel(x)} enregistré.`);
	}
	/** Empty value: the pair goes back to the default (the larger intercourse of both consumers). */
	async savePairIntercourse(x, y, value) {
		await this.run(async () => {
			this.intercoursePairs = await fetcher.setIntercoursePair(x.id, y.id, String(value).trim() === "" ? null : this.intercourseInput(value));
		}, `Intercours entre ${this.consumerLabel(x)} et ${this.consumerLabel(y)} enregistré.`);
	}
	/** Greyed bands after each meeting (or proposal) followed by another one the same day: the intercourse to keep. */
	buildGaps(meetings) {
		const items = [...meetings.map((m) => ({
			a: m.assignationId,
			s: Date.parse(m.startAt),
			e: Date.parse(m.startAt) + m.durationMinutes * 6e4
		})), ...this.proposals.map((p) => ({
			a: p.assignationId,
			s: p.start.getTime(),
			e: p.end.getTime()
		}))].sort((x, y) => x.s - y.s);
		const out = [];
		for (let i = 0; i + 1 < items.length; i++) {
			const cur = items[i], next = items[i + 1];
			if (new Date(cur.e).toDateString() !== new Date(next.s).toDateString()) continue;
			const g = this.gap(cur.a, next.a);
			if (g <= 0) continue;
			out.push({
				id: `gap-${cur.s}-${next.s}`,
				kind: "meeting",
				title: `Intercours ${g} min`,
				raw: null,
				status: next.s < cur.e + g * 6e4 ? "short" : void 0,
				start: new Date(cur.e),
				end: new Date(cur.e + g * 6e4)
			});
		}
		return out;
	}
	/**
	* Proposes one meeting per consumer (shown in the filter), lasting min(maximum length, hours he still asks for),
	* placed so that it suits the most consumers over the visible period.
	*/
	proposeMeetings() {
		const maxMinutes = Number(this.planForm.maxMinutes);
		if (!Number.isInteger(maxMinutes) || maxMinutes < 15 || maxMinutes % 15) {
			this.error = "La durée maximale est un multiple de 15 minutes.";
			return;
		}
		const { from, to } = this.cal.range;
		const remaining = /* @__PURE__ */ new Map();
		for (const r of this.requests) if ((r.status ?? "open") !== "open") remaining.set(r.id, 0);
		else remaining.set(r.id, r.remainingMinutes ?? Math.round((r.requestedHours - (r.scheduledHours ?? 0)) * 60));
		this.proposals = plan({
			from: Date.parse(from),
			to: Date.parse(to),
			now: Date.now(),
			maxMinutes,
			dispos: [...this.dispos, ...this.virtualDispos].filter((d) => this.isVisible(d.assignationId)),
			suggestions: [...this.suggestions, ...this.virtualSuggestions],
			contracts: this.contracts,
			assignations: this.assignations,
			remaining,
			meetings: this.meetings.filter((m) => m.status !== "canceledBy"),
			gap: (a, b) => this.gap(a, b)
		});
		this.closePanel();
		this.cal.events = this.buildEvents();
		const n = this.proposals.length;
		const people = new Set(this.proposals.map((p) => p.assignationId)).size;
		if (n) {
			this.error = "";
			this.notice = `${n} proposition${n > 1 ? "s" : ""} pour ${people} consommateur${people > 1 ? "s" : ""}. Rien n’est enregistré tant que vous ne validez pas.`;
		} else {
			this.notice = "";
			this.error = "Aucune proposition possible sur cette période (disponibilités, horaires, heures demandées ou intercours).";
		}
	}
	async bookProposal(p) {
		await fetcher.createMeeting({
			assignationId: p.assignationId,
			startAt: p.start.toISOString(),
			durationMinutes: Math.round((p.end.getTime() - p.start.getTime()) / 6e4),
			roomName: null,
			comment: "",
			idempotencyKey: `${p.id}-${uid()}`
		});
		this.proposals = this.proposals.filter((x) => x.id !== p.id);
	}
	/** The proposal becomes a meeting on screen at once; it comes back if the server refuses it. */
	async validateProposal() {
		const p = this.panel.ev.raw;
		this.closePanel();
		const tmp = this.tempMeeting(p.assignationId, p.start, Math.round((p.end.getTime() - p.start.getTime()) / 6e4));
		await this.optimistic(() => {
			this.proposals = this.proposals.filter((x) => x.id !== p.id);
			this.meetings = [...this.meetings, tmp];
			return () => {
				this.meetings = this.meetings.filter((m) => m.id !== tmp.id);
				this.proposals = [...this.proposals, p];
			};
		}, async () => {
			const r = await fetcher.createMeeting({
				assignationId: p.assignationId,
				startAt: p.start.toISOString(),
				durationMinutes: tmp.durationMinutes,
				roomName: null,
				comment: "",
				idempotencyKey: `${p.id}-${uid()}`
			});
			this.meetings = this.meetings.map((m) => m.id === tmp.id ? r.meeting : m);
		}, "Rendez-vous créé.");
	}
	/** Meeting drawn before the server created it. */
	tempMeeting(assignationId, start, durationMinutes, roomName = null, comment = "") {
		return {
			id: tempId(),
			assignationId,
			startAt: start.toISOString(),
			durationMinutes,
			status: "pending",
			roomName,
			comment,
			_pending: true
		};
	}
	eraseProposal() {
		const p = this.panel.ev.raw;
		this.proposals = this.proposals.filter((x) => x.id !== p.id);
		this.closePanel();
		this.cal.events = this.buildEvents();
	}
	clearProposals() {
		this.proposals = [];
		if (this.panel?.type === "proposal") this.closePanel();
		this.cal.events = this.buildEvents();
	}
	/** Books every proposal; the ones the server refuses stay displayed. */
	async validateAllProposals() {
		if (!confirm(`Créer les ${this.proposals.length} rendez-vous proposés ?`)) return;
		const failed = [];
		await this.run(async () => {
			for (const p of [...this.proposals]) try {
				await this.bookProposal(p);
			} catch (e) {
				failed.push(`${this.who(p.assignationId)} (${this.fmt(p.start.toISOString())}) : ${e?.message ?? "refusé"}`);
			}
			if (this.panel?.type === "proposal") this.closePanel();
			await this.refreshAgenda();
			if (failed.length) throw new Error(`Non créés : ${failed.join(" · ")}`);
		}, "Tous les rendez-vous proposés ont été créés.");
	}
	/** Move an editable availability/suggestion by dropping it at a new date/time. */
	async dropEvent(e, day) {
		e.preventDefault();
		const payload = e.dataTransfer?.getData("text/calendar-event");
		if (!payload) return;
		let data;
		try {
			data = JSON.parse(payload);
		} catch {
			return;
		}
		if (data.kind !== "dispo" && data.kind !== "suggestion") return;
		const rect = e.currentTarget.getBoundingClientRect();
		const minutes = this.cal.settings.startHour * 60 + Math.floor((e.clientY - rect.top) / rect.height * this.cal.hours.length * 60 / 15) * 15;
		const start = new Date(day);
		start.setHours(0, minutes, 0, 0);
		if (start.getTime() <= Date.now()) {
			this.error = "Impossible de déplacer un créneau dans le passé.";
			return;
		}
		const body = {
			startAt: start.toISOString(),
			durationMinutes: data.duration,
			love: data.love ?? .5
		};
		await this.saveRow(data.kind === "dispo" ? "dispos" : "suggestions", data.id, body, "Créneau déplacé.");
	}
	/**
	* Moves / changes one of my intervals on screen at once, then on the server. A generated occurrence changed by
	* hand leaves its repetition (the server cancels it there), the screen does the same.
	*/
	async saveRow(list, id, body, ok) {
		const before = this[list].find((x) => x.id === id);
		if (!before) return;
		await this.optimistic(() => {
			const undoCancel = before.generatorId ? this.setCancellations(before.generatorId, (d) => [.../* @__PURE__ */ new Set([...d, before.generatorOccurrence])]) : null;
			this[list] = this[list].map((x) => x.id === id ? {
				...x,
				...body,
				generatorId: null,
				generatorOccurrence: null,
				_pending: true
			} : x);
			return () => {
				undoCancel?.();
				this[list] = this[list].map((x) => x.id === id ? before : x);
			};
		}, async () => {
			const saved = list === "dispos" ? await fetcher.updateDispo(id, body) : await fetcher.updateSuggestion(id, body);
			this[list] = this[list].map((x) => x.id === id ? saved : x);
		}, ok);
	}
	dragCalendarEvent(e, ev) {
		if (!ev.editable || ev.kind !== "dispo" && ev.kind !== "suggestion") {
			e.preventDefault();
			return;
		}
		e.dataTransfer?.setData("text/calendar-event", JSON.stringify({
			kind: ev.kind,
			id: ev.raw.id,
			duration: Math.round((ev.end.getTime() - ev.start.getTime()) / 6e4),
			love: ev.raw.love
		}));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
	}
	async selectAgent(value) {
		this.selAssign = Number(value);
		this.closePanel();
		if (this.page === "consumer-habits") {
			this.habitCal.events = this.buildHabitEvents();
			return;
		}
		await this.refreshAgenda();
	}
	async createRequest() {
		await this.run(async () => {
			const hours = Number(this.form.hours);
			if (!(hours > 0)) throw new Error("Indiquez un nombre d’heures supérieur à 0, ou ajoutez directement vos disponibilités.");
			await fetcher.createRequest(this.selAssign, hours);
			this.form = {};
			await this.refreshAgenda();
		}, "Demande enregistrée. Ajoutez maintenant vos disponibilités dans l’agenda.");
	}
	/**
	* Consumer: change the hours of the current request at any time.
	* With `unlimited`, the limit is removed (the request goes back to "sans limite d’heures").
	*/
	async updateRequestHours(unlimited = false) {
		const request = this.currentRequest();
		if (!request) return;
		await this.run(async () => {
			let hours = null;
			if (!unlimited) {
				hours = Number(String(this.form.editHours ?? "").replace(",", "."));
				if (!(hours > 0)) throw new Error("Indiquez un nombre d’heures supérieur à 0.");
			}
			await fetcher.updateRequestHours(request.id, hours);
			this.form.editHours = "";
			await this.refreshAgenda();
		}, unlimited ? "La limite d’heures est retirée." : "Nombre d’heures mis à jour.");
	}
	closePanel() {
		this.panel = null;
		this.cal.selection = null;
		this.habitCal.selection = null;
	}
	/** Fallback for keyboard and touch users who do not want to pick a slot in the grid. */
	openCreate() {
		const s = /* @__PURE__ */ new Date();
		s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
		this.beginInterval(s, new Date(s.getTime() + 36e5));
	}
	/** A slot was drawn: the agent books a meeting when the gesture started on an availability, else adds his hours. */
	beginInterval(start, end, origin = null) {
		if (end.getTime() <= Date.now()) {
			this.cal.selection = null;
			this.error = "Ce créneau est déjà passé.";
			return;
		}
		if (this.role === "agent" && origin?.kind === "dispo") {
			this.error = "";
			this.openBook(origin, start, end);
			return;
		}
		if (this.role === "consumer" && this.selAssign === null) {
			this.cal.selection = null;
			this.error = "Aucun agent ne vous est assigné.";
			return;
		}
		if (this.role === "agent" && !this.contracts.length) {
			this.cal.selection = null;
			this.error = "Aucun contrat actif : demandez à votre administrateur.";
			return;
		}
		this.error = "";
		this.panel = {
			type: "interval",
			error: "",
			form: {
				id: null,
				start: toLocalInput(start),
				duration: Math.round((end.getTime() - start.getTime()) / 6e4),
				love: .5,
				contractId: this.contracts[0]?.id,
				repeat: false,
				intervalWeeks: 1
			}
		};
	}
	openEvent(ev) {
		this.error = "";
		if (ev.pending) {
			this.error = "Enregistrement en cours… réessayez dans un instant.";
			return;
		}
		if (ev.kind === "meeting") return this.openMeeting(ev.raw);
		if (ev.kind === "slot") {
			this.panel = {
				type: "slot",
				ev,
				error: ""
			};
			return;
		}
		if (ev.kind === "proposal") {
			this.panel = {
				type: "proposal",
				ev,
				error: ""
			};
			return;
		}
		if (ev.kind === "dispo" && this.role === "agent") return void this.openBook(ev);
		if (ev.virtual) {
			this.panel = {
				type: "occurrence",
				ev,
				gen: this.generatorOf(ev.raw.generatorId),
				error: ""
			};
			return;
		}
		this.panel = {
			type: "interval",
			error: "",
			form: {
				id: ev.raw.id,
				start: toLocalInput(new Date(ev.raw.startAt)),
				duration: ev.raw.durationMinutes,
				love: ev.raw.love ?? .5,
				contractId: ev.raw.contractId,
				generatorId: ev.raw.generatorId ?? null,
				occurrence: ev.raw.generatorOccurrence ?? null
			}
		};
	}
	/** Consumer: turn the agent's slot into a new availability (prefilled form). */
	useSlot() {
		const ev = this.panel.ev;
		this.beginInterval(ev.start, ev.end);
	}
	/** Saves the slot of the panel: shown at once, sent in the background. "Répéter" creates a weekly repetition instead. */
	async submitInterval() {
		const f = this.panel.form;
		const start = new Date(f.start);
		const duration = Number(f.duration);
		const love = Number(f.love);
		if (!this.check(() => {
			if (Number.isNaN(start.getTime())) throw new Error("La date de début est invalide.");
			if (!Number.isInteger(duration) || duration <= 0) throw new Error("La durée doit être un nombre entier de minutes.");
			if (!(love >= 0 && love <= 1)) throw new Error("La préférence doit être comprise entre 0 et 1.");
			if (start.getTime() + duration * 6e4 <= Date.now()) throw new Error("Ce créneau est déjà passé.");
			if (f.repeat && duration > 1440) throw new Error("Un créneau répété dure 24 h au plus.");
		})) return;
		const body = {
			startAt: start.toISOString(),
			durationMinutes: duration,
			love
		};
		const list = this.role === "consumer" ? "dispos" : "suggestions";
		if (!f.id && f.repeat) {
			const tz = browserTimeZone();
			const form = {
				...newGenForm(),
				weekday: start.getDay(),
				start: hhmm(start.getHours() * 60 + start.getMinutes()),
				duration,
				love,
				intervalWeeks: Number(f.intervalWeeks) || 1,
				startsOn: localDate(start.getTime(), tz),
				contractId: Number(f.contractId) || null
			};
			let ok = false;
			this.check(() => {
				this.generatorBody(form);
				ok = true;
			});
			if (!ok) return;
			this.closePanel();
			return this.saveGenerator(form);
		}
		this.closePanel();
		if (f.id) return this.saveRow(list, f.id, body, "Créneau enregistré.");
		const tmp = this.role === "consumer" ? {
			id: tempId(),
			assignationId: this.selAssign,
			requestId: this.currentRequest()?.id,
			...body,
			_pending: true
		} : {
			id: tempId(),
			contractId: Number(f.contractId),
			...body,
			_pending: true
		};
		await this.optimistic(() => {
			this[list] = [...this[list], tmp];
			return () => {
				this[list] = this[list].filter((x) => x.id !== tmp.id);
			};
		}, async () => {
			const saved = this.role === "consumer" ? await fetcher.createDispo({
				assignationId: tmp.assignationId,
				requestId: tmp.requestId,
				...body
			}) : await fetcher.createSuggestion({
				contractId: tmp.contractId,
				...body
			});
			this[list] = this[list].map((x) => x.id === tmp.id ? saved : x);
		}, "Créneau enregistré.");
	}
	async deleteInterval() {
		const f = this.panel.form;
		if (!confirm(f.generatorId ? "Supprimer cette occurrence ? La répétition continue les autres semaines." : "Supprimer ce créneau ?")) return;
		const id = f.id, list = this.role === "consumer" ? "dispos" : "suggestions";
		const row = this[list].find((x) => x.id === id);
		this.closePanel();
		await this.optimistic(() => {
			const undoCancel = row?.generatorId ? this.setCancellations(row.generatorId, (d) => [.../* @__PURE__ */ new Set([...d, row.generatorOccurrence])]) : null;
			this[list] = this[list].filter((x) => x.id !== id);
			return () => {
				undoCancel?.();
				if (row) this[list] = [...this[list], row];
			};
		}, async () => {
			if (list === "dispos") await fetcher.deleteDispo(id);
			else await fetcher.deleteSuggestion(id);
		}, "Créneau supprimé.");
	}
	/**
	* The meeting starts at the clicked quarter hour (or at the start of the availability when clicked elsewhere).
	* When a slot was drawn from the availability, the meeting takes exactly that slot.
	*/
	async openBook(ev, from, to) {
		const at = this.cal.lastPoint?.getTime() ?? 0;
		const start = from ?? (at >= ev.start.getTime() && at < ev.end.getTime() ? new Date(at) : ev.start);
		const minutes = to ? Math.round((to.getTime() - start.getTime()) / 6e4) : Math.min(60, Math.round((ev.end.getTime() - start.getTime()) / 6e4));
		this.panel = {
			type: "book",
			ev,
			error: "",
			key: uid(),
			rooms: [],
			form: {
				assignationId: ev.raw.assignationId,
				start: toLocalInput(start),
				duration: minutes,
				roomName: "",
				comment: ""
			}
		};
		await this.checkRooms();
	}
	async checkRooms() {
		const p = this.panel;
		if (!p || p.type !== "book") return;
		const start = new Date(p.form.start);
		const duration = Number(p.form.duration);
		if (Number.isNaN(start.getTime()) || !Number.isInteger(duration) || duration <= 0) return;
		try {
			p.rooms = await fetcher.roomsAvailability(start.toISOString(), duration);
		} catch {
			p.rooms = [];
		}
		if (p.form.roomName && p.rooms.some((r) => r.name === p.form.roomName && r.available === false)) p.form.roomName = "";
	}
	/** The meeting is drawn at once (checked here like the server does), and removed again if the server refuses it. */
	async submitBook() {
		const p = this.panel;
		const f = p.form;
		const start = new Date(f.start);
		const duration = Number(f.duration);
		if (!this.check(() => {
			if (Number.isNaN(start.getTime()) || !Number.isInteger(duration) || duration <= 0) throw new Error("Date ou durée invalide.");
			if (start.getTime() <= Date.now()) throw new Error("Un rendez-vous doit commencer dans le futur.");
			const ev = p.ev;
			const end = start.getTime() + duration * 6e4;
			const related = [...this.dispos, ...this.virtualDispos].filter((d) => d.assignationId === f.assignationId && d.requestId === ev.raw.requestId).map((d) => ({
				start: Date.parse(d.startAt),
				end: Date.parse(d.startAt) + d.durationMinutes * 6e4
			})).sort((a, b) => a.start - b.start);
			let coveredUntil = start.getTime();
			for (const interval of related) {
				if (interval.end <= coveredUntil) continue;
				if (interval.start > coveredUntil) break;
				coveredUntil = Math.max(coveredUntil, interval.end);
				if (coveredUntil >= end) break;
			}
			if (coveredUntil < end) {
				const windowEnd = related.find((interval) => interval.start <= start.getTime() && interval.end >= start.getTime())?.end ?? ev.end.getTime();
				throw new Error(`Le rendez-vous doit rester dans une disponibilité continue à partir de ${this.cal.time(new Date(start.getTime()))} (disponible jusqu’à ${this.cal.time(new Date(windowEnd))}).`);
			}
			const s = start.getTime();
			if (this.meetings.some((m) => m.status !== "canceledBy" && Date.parse(m.startAt) < end && Date.parse(m.startAt) + m.durationMinutes * 6e4 > s)) throw new Error("Vous avez déjà un rendez-vous sur ce créneau.");
		})) return;
		this.closePanel();
		const tmp = this.tempMeeting(f.assignationId, start, duration, f.roomName || null, f.comment ?? "");
		await this.optimistic(() => {
			this.meetings = [...this.meetings, tmp];
			return () => {
				this.meetings = this.meetings.filter((m) => m.id !== tmp.id);
			};
		}, async () => {
			const r = await fetcher.createMeeting({
				assignationId: f.assignationId,
				startAt: start.toISOString(),
				durationMinutes: duration,
				roomName: f.roomName || null,
				comment: f.comment ?? "",
				idempotencyKey: p.key
			});
			this.meetings = this.meetings.map((m) => m.id === tmp.id ? r.meeting : m);
		}, "Rendez-vous créé.");
	}
	openMeeting(m) {
		this.panel = {
			type: "meeting",
			m,
			error: "",
			form: {
				comment: m.comment ?? "",
				roomName: m.roomName ?? m.room ?? "",
				actual: m.durationMinutes
			}
		};
	}
	/** "60 min" or, for a meeting validated with another duration, "60 min prévues · 45 min effectuées". */
	durationLabel(m) {
		const a = m.actualDurationMinutes;
		return a != null && a !== m.durationMinutes ? `${m.durationMinutes} min prévues · ${a} min effectuées` : `${a ?? m.durationMinutes} min`;
	}
	canEditMeeting(m) {
		return this.role === "agent" && m.status === "pending" && m.id > 0;
	}
	canCancelMeeting(m) {
		return m.status === "pending" && m.id > 0;
	}
	/** Changes one meeting of the agenda on screen; returns how to undo it. */
	patchMeetingLocal(id, change) {
		const before = this.meetings.find((m) => m.id === id);
		this.meetings = this.meetings.map((m) => m.id === id ? {
			...m,
			...change
		} : m);
		return () => {
			if (before) this.meetings = this.meetings.map((m) => m.id === id ? before : m);
		};
	}
	async saveMeeting() {
		const p = this.panel;
		const id = p.m.id, change = {
			comment: p.form.comment,
			roomName: p.form.roomName || null
		};
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, change), async () => {
			await fetcher.patchMeeting(id, change);
		}, "Rendez-vous mis à jour.");
	}
	/** Validates the meeting with the duration really spent (the booked one by default). */
	async markDone() {
		const p = this.panel;
		const minutes = Number(p.form.actual);
		if (!this.check(() => {
			if (!Number.isInteger(minutes) || minutes <= 0) throw new Error("La durée réelle est un nombre entier de minutes, supérieur à 0.");
		})) return;
		const id = p.m.id, actual = minutes === p.m.durationMinutes ? null : minutes;
		const change = {
			comment: p.form.comment,
			roomName: p.form.roomName || null
		};
		const changed = change.comment !== (p.m.comment ?? "") || change.roomName !== (p.m.roomName ?? null);
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, {
			...change,
			status: "done",
			actualDurationMinutes: actual
		}), async () => {
			if (changed) await fetcher.patchMeeting(id, change);
			await fetcher.patchMeeting(id, {
				status: "done",
				actualDurationMinutes: actual
			});
		}, "Rendez-vous marqué comme terminé.");
	}
	async cancelMeeting() {
		if (!confirm("Annuler ce rendez-vous ?")) return;
		const id = this.panel.m.id;
		this.closePanel();
		await this.optimistic(() => this.patchMeetingLocal(id, { status: "canceledBy" }), async () => {
			await fetcher.cancelMeeting(id);
		}, "Rendez-vous annulé.");
	}
}();
var dom = module_default.reactive(raw);
raw.bindAll(dom);
//#endregion
//#region client/src/index.ts
function init() {
	dom.start();
}
//#endregion
export { init };
