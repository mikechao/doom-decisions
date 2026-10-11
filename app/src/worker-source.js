// Import text, never stringify bundler-transformed functions.
export function classicWorkerSource(raw) {
  const wrapper = 'export {i11MaskValid, i11VerifyStep, i11Action, titleWorker};';
  if (raw.split(wrapper).length !== 2 ||
      (raw.match(/^export\b/gm) || []).length !== 1) {
    throw new Error('Unexpected Worker module wrapper.');
  }
  return raw.replace(wrapper, '') + '\ntitleWorker();\n';
}
