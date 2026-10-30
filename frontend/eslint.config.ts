import js from "@eslint/js"
import stylistic from "@stylistic/eslint-plugin"
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript"
import { createNodeResolver, importX } from "eslint-plugin-import-x"
import reactHooks from "eslint-plugin-react-hooks"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import globals from "globals"
import tseslint from "typescript-eslint"

const HEX_LITERAL_RULE = {
  selector: "Literal[value=/^#[0-9A-Fa-f]{3,8}$/]",
  message: "Raw hex colors are not allowed. Reference a design token from app/styles/tailwind.css through a utility class (e.g. bg-brand) instead. Add a token to @theme if one does not exist yet.",
}

/** A class with an arbitrary value, such as `w-[150px]` or `hover:grid-cols-[1fr_2fr]`, in any string: a class attribute, a constant, or a template. */
const ARBITRARY_CLASS = "/(^|\\s)[\\w:-]*-\\[[^\\]]+\\]/"
const ARBITRARY_MESSAGE = "Tailwind arbitrary values are not allowed. Reference a design token through a utility class instead. Add a token to @theme if one does not exist yet."
const ARBITRARY_CLASSNAME_RULES = [
  { selector: `Literal[value=${ARBITRARY_CLASS}]`, message: ARBITRARY_MESSAGE },
  { selector: `TemplateElement[value.raw=${ARBITRARY_CLASS}]`, message: ARBITRARY_MESSAGE },
]

/**
 * A component is an arrow function. `func-style` rejects a function declaration, and `prefer-arrow-callback` rejects a
 * function expression that is passed as an argument. These selectors reject the other forms.
 */
const FUNCTION_FORM_RULES = [
  { selector: "VariableDeclarator > FunctionExpression", message: "Assign an arrow function instead of a function expression." },
  { selector: "ExportDefaultDeclaration > FunctionDeclaration", message: "Export a constant that holds an arrow function instead of a function declaration." },
]

/** The raw elements that have a component in ~/ui, which features and routes use instead. */
const RAW_ELEMENT_RULES = [
  { name: "button", message: "Raw <button> is not allowed. Use <Button> from ~/ui instead." },
  { name: "a", message: "Raw <a> is not allowed. Use <Link> from react-router, or <ExternalLink> or <DownloadLink> from ~/ui, instead." },
  { name: "input", message: "Raw <input> is not allowed. Use <TextInput>, <CheckboxRow>, or <Toggle> from ~/ui instead." },
  { name: "select", message: "Raw <select> is not allowed. Use <Select> from ~/ui instead." },
  { name: "textarea", message: "Raw <textarea> is not allowed. Use <TextArea> from ~/ui instead." },
].map(({ name, message }) => ({ selector: `JSXOpeningElement[name.name="${name}"]`, message }))

const MIDDLE_DOT_MESSAGE =
  "The middle dot (U+00B7) is not used in text that the app shows. Separate items with a comma, parentheses, a line break, or space between elements."

/** Strings, template text, and JSX text that contain a middle dot. Comments are not checked. */
const MIDDLE_DOT_RULES = [
  { selector: "Literal[value=/\\u00B7/]", message: MIDDLE_DOT_MESSAGE },
  { selector: "TemplateElement[value.raw=/\\u00B7/]", message: MIDDLE_DOT_MESSAGE },
  { selector: "JSXText[value=/\\u00B7/]", message: MIDDLE_DOT_MESSAGE },
]

export default tseslint.config(
  {
    ignores: [
      ".react-router/",
      "build/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "app/lib/api/openapi-types.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({ project: "./tsconfig.json" }),
        createNodeResolver(),
      ],
    },
    plugins: {
      "react-hooks": reactHooks,
      "@stylistic": stylistic,
      "simple-import-sort": simpleImportSort,
      "import-x": importX,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-restricted-syntax": ["error", ...FUNCTION_FORM_RULES],

      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/array-type": ["error", { default: "array" }],
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],

      "no-console": "warn",

      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",

      "import-x/no-restricted-paths": ["error", {
        zones: [
          { target: "./app/features/landing", from: "./app/features", except: ["./landing"] },
          { target: "./app/features/workspace", from: "./app/features", except: ["./workspace"] },
          { target: "./app/features/sample", from: "./app/features", except: ["./sample"] },

          { target: "./app/shell", from: "./app/features" },

          { target: "./app/ui", from: "./app/features" },
          { target: "./app/ui", from: "./app/shell" },
          { target: "./app/ui", from: "./app/lib" },
          { target: "./app/ui", from: "./app/schemas" },

          { target: "./app/lib", from: "./app/features" },
          { target: "./app/lib", from: "./app/shell" },
          { target: "./app/lib", from: "./app/ui" },
        ],
      }],

      "@stylistic/semi": ["error", "never"],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/jsx-quotes": ["error", "prefer-double"],
      "@stylistic/no-multi-spaces": "error",
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1 }],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/member-delimiter-style": ["error", {
        multiline: { delimiter: "none", requireLast: false },
        singleline: { delimiter: "semi", requireLast: false },
      }],
    },
  },

  {
    files: ["app/*.{ts,tsx}", "app/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...FUNCTION_FORM_RULES, ...MIDDLE_DOT_RULES],
    },
  },

  {
    files: ["app/{features,routes}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...FUNCTION_FORM_RULES,
        HEX_LITERAL_RULE,
        ...ARBITRARY_CLASSNAME_RULES,
        ...MIDDLE_DOT_RULES,
        ...RAW_ELEMENT_RULES,
      ],
    },
  },

  {
    files: ["app/{ui,shell}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...FUNCTION_FORM_RULES, HEX_LITERAL_RULE, ...MIDDLE_DOT_RULES],
    },
  },

  {
    files: ["**/*.config.{ts,js,mjs}", "nginx/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: {
      "func-style": "off",
      "prefer-arrow-callback": "off",
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },

  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-console": "off",
    },
  },
)
