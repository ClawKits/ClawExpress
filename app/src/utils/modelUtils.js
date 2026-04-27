/**
 * modelUtils.js
 * Shared utility for stripping known provider prefixes from model identifiers.
 * Kept in a separate module so it can be imported by both component files and
 * non-component files without breaking Vite's Fast Refresh constraint
 * (component files must only export React components).
 */

export const stripModelPrefix = (model) => {
  if (!model) return '';
  return model
    .replace(/^litellm\//i, '')
    .replace(/^openai-codex\//i, '')
    .replace(/^openai\//i, '')
    .replace(/^ollama\//i, '')
    .replace(/^nvidia_nim\//i, '')
    .replace(/^groq\//i, '')
    .replace(/^xai\//i, '')
    .replace(/^openrouter\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^gemini\//i, '')
    .replace(/^google-gemini-cli\//i, '')
    .replace(/^google\//i, '')
    .replace(/^deepseek\//i, '')
    .replace(/^together_ai\//i, '')
    .replace(/^moonshot\//i, '')
    .replace(/^mistral\//i, '')
    .replace(/^local\//i, '');
};
