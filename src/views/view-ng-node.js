import { runtime, unwrap } from "/core/runtime.js"
import { normalizeNgPresetDraft, ngPresetKind } from "/util/ng-node-preset.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"

const NG = {
    NODE_GOAL: 1,
    NODE_CODE: 2,
    NODE_GROUP: 3,
    NODE_VALUE: 4,
    NODE_GRAPH_INPUT: 5,
    NODE_GRAPH_OUTPUT: 6,
    NODE_FOR_EACH: 7,
    NODE_FOR_EACH_INPUT: 8,
    NODE_ITERATION_CONTROL: 9,
    NODE_FOR_EACH_SHARED_INPUT: 10,
    NODE_FOR_EACH_GET_VAR: 11,
    NODE_FOR_EACH_SET_VAR: 12,
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function escapeAttribute(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

function dirname(path) {
    const normalized = String(path || "")
        .trim()
        .replace(/\/+/g, "/")
    if (!normalized || normalized === "/") return "/"
    const slashIndex = normalized.lastIndexOf("/")
    if (slashIndex <= 0) return "/"
    return normalized.slice(0, slashIndex)
}

function kindToFormValue(kind) {
    if (kind === NG.NODE_VALUE) return "value"
    if (kind === NG.NODE_GOAL) return "goal"
    if (kind === NG.NODE_GROUP) return "group"
    if (kind === NG.NODE_GRAPH_INPUT) return "input"
    if (kind === NG.NODE_GRAPH_OUTPUT) return "output"
    if (kind === NG.NODE_FOR_EACH) return "for-each"
    if (kind === NG.NODE_FOR_EACH_INPUT) return "for-each-input"
    if (kind === NG.NODE_FOR_EACH_SHARED_INPUT) return "for-each-shared-input"
    if (kind === NG.NODE_FOR_EACH_GET_VAR) return "for-each-get-var"
    if (kind === NG.NODE_FOR_EACH_SET_VAR) return "for-each-set-var"
    if (kind === NG.NODE_ITERATION_CONTROL) return "iteration-control"
    return "code"
}

function kindFromFormValue(value, fallback = NG.NODE_CODE) {
    if (value === "value") return NG.NODE_VALUE
    if (value === "goal") return NG.NODE_GOAL
    if (value === "group" || value === "import") return NG.NODE_GROUP
    if (value === "input") return NG.NODE_GRAPH_INPUT
    if (value === "output") return NG.NODE_GRAPH_OUTPUT
    if (value === "for-each") return NG.NODE_FOR_EACH
    if (value === "for-each-input") return NG.NODE_FOR_EACH_INPUT
    if (value === "for-each-shared-input") return NG.NODE_FOR_EACH_SHARED_INPUT
    if (value === "for-each-get-var") return NG.NODE_FOR_EACH_GET_VAR
    if (value === "for-each-set-var") return NG.NODE_FOR_EACH_SET_VAR
    if (value === "iteration-control") return NG.NODE_ITERATION_CONTROL
    if (value === "code") return NG.NODE_CODE
    return fallback
}

function nodeSupportsInputs(kind) {
    return kind === NG.NODE_CODE || kind === NG.NODE_GOAL || kind === NG.NODE_GRAPH_OUTPUT || kind === NG.NODE_FOR_EACH_GET_VAR || kind === NG.NODE_FOR_EACH_SET_VAR
}

function nodeSupportsOutputs(kind) {
    return kind === NG.NODE_CODE || kind === NG.NODE_VALUE || kind === NG.NODE_GRAPH_INPUT
}

function createNodeDraft(kind = NG.NODE_CODE) {
    return {
        kind,
        templateName: "",
        name: "",
        ...(kind === NG.NODE_CODE ? {
            codePath: "",
            code: "",
            codeReadOnly: true,
            codeStatus: "Choose a code file to edit.",
        } : {}),
        newInputName: "",
        newOutputName: "",
        newOutputValue: "",
        inputs: [],
        outputs: [],
    }
}

function normalizeTemplatePayload(payload, fallbackKind = NG.NODE_CODE) {
    const preset = normalizeNgPresetDraft(payload, fallbackKind)
    const normalized = createNodeDraft(preset.kind)
    normalized.name = preset.name
    normalized.inputs = preset.inputs
    normalized.outputs = preset.outputs
    if (preset.kind === NG.NODE_CODE) {
        normalized.codePath = preset.codePath
        normalized.code = preset.code
        normalized.codeReadOnly = !normalized.codePath || Boolean(normalized.code)
        normalized.codeStatus = normalized.codePath
            ? ""
            : normalized.code
              ? "Legacy inline code detected. Choose a file path and edit it in view-code."
              : "Choose a code file to edit."
    }
    if (preset.kind === NG.NODE_GROUP) normalized.storage = structuredClone(preset.storage)
    if (preset.childGraph !== undefined) normalized.childGraph = structuredClone(preset.childGraph)
    return normalized
}

export class ViewNgNode extends HTMLElement {
    constructor() {
        super()
        this.popupProps = this.popupProps || {}
        this.mode = "create"
        this.nodeId = 0
        this.formElement = null
        this.statusOutput = null
        this.templates = []
        this.draft = null
    }

    _createInitialDraft() {
        if (this.mode === "edit") {
            const kind = Number(this.popupProps?.kind || NG.NODE_CODE)
            const draft = createNodeDraft(kind)
            draft.name = String(this.popupProps?.nodeName || "").trim()
            draft.inputs = (Array.isArray(this.popupProps?.inputLabels) ? this.popupProps.inputLabels : []).map(
                (name, index) => ({
                    inputId: index + 1,
                    name: String(name || ""),
                }),
            )
            draft.outputs = (Array.isArray(this.popupProps?.outputLabels) ? this.popupProps.outputLabels : []).map(
                (value, index) => ({
                    outputId: index + 1,
                    name: kind === NG.NODE_VALUE ? "" : String(value || ""),
                    value: kind === NG.NODE_VALUE ? String(value || "") : "",
                }),
            )
            if (kind === NG.NODE_CODE) {
                draft.codePath = String(this.popupProps?.codePath || "").trim()
                draft.code = String(this.popupProps?.code || "")
                draft.codeReadOnly = Boolean(this.popupProps?.codeReadOnly ?? !draft.codePath)
                draft.codeStatus = String(
                    this.popupProps?.codeStatus ||
                        (!draft.codePath ? "Choose a code file to edit." : ""),
                )
            }
            return draft
        }
        return createNodeDraft(NG.NODE_CODE)
    }

    connectedCallback() {
        registerViewPlugin(this)
        if (this.dataset.ready) return
        this.dataset.ready = "1"
        this.popupProps = this.popupProps || {}
        this.mode = String(this.popupProps?.mode || "create")
        this.nodeId = Number(this.popupProps?.nodeId || 0)
        this.draft = this._createInitialDraft()
        this.style.display = "contents"
        this.innerHTML = '<form data-element="form" novalidate></form>'
        this.formElement = this.querySelector('[data-element="form"]')
        assert(this.formElement instanceof HTMLFormElement, "view-ng-node missing form")

        this.formElement.addEventListener("submit", async (event) => {
            event.preventDefault()
            await this.handleSubmit(event)
        })

        void this.initialize()
    }

    async initialize() {
        this.loadTemplates()
        this.ensureDraftShape()
        this.renderForm()
        queueMicrotask(() => {
            const nameInput = this.querySelector('[data-field="name"]')
            if (nameInput instanceof HTMLInputElement) {
                nameInput.focus()
                nameInput.select()
            }
        })
    }

    loadTemplates() {
        const presets = this.config?.presets || []
        this.templates = presets
            .map((entry) => {
                const name = String(entry?.name || "").trim()
                if (!name) return null
                const kind = ngPresetKind(entry?.kind, NG.NODE_CODE)
                const ownerKind = Number(this.popupProps.childGraphOwnerKind || 0)
                if (kind === NG.NODE_GRAPH_INPUT && ownerKind !== NG.NODE_GROUP) return null
                if (kind === NG.NODE_GRAPH_OUTPUT && ![NG.NODE_GROUP, NG.NODE_FOR_EACH].includes(ownerKind)) return null
                if ([NG.NODE_FOR_EACH_INPUT, NG.NODE_FOR_EACH_SHARED_INPUT, NG.NODE_FOR_EACH_GET_VAR, NG.NODE_FOR_EACH_SET_VAR, NG.NODE_ITERATION_CONTROL].includes(kind) && ownerKind !== NG.NODE_FOR_EACH) return null
                if (kind === NG.NODE_GOAL && this.popupProps.insideForEach) return null
                const group = String(entry?.group || "Presets").trim() || "Presets"
                return {
                    name,
                    kind,
                    group,
                    data: { ...entry, name, kind, group },
                }
            })
            .filter(Boolean)
    }

    ensureDraftShape() {
        if (this.draft.kind !== NG.NODE_CODE) {
            delete this.draft.codePath
            delete this.draft.code
            delete this.draft.codeReadOnly
            delete this.draft.codeStatus
        }
        if (this.draft.kind === NG.NODE_GROUP || this.draft.kind === NG.NODE_FOR_EACH) {
            this.draft.inputs = []
            this.draft.outputs = []
            return
        }
        if (this.draft.kind === NG.NODE_FOR_EACH_INPUT) {
            this.draft.inputs = []
            this.draft.outputs = ["Item", "Index", "Array"].map((name, index) => ({ outputId: index + 1, name, value: "" }))
            return
        }
        if (this.draft.kind === NG.NODE_FOR_EACH_SHARED_INPUT) {
            this.draft.inputs = []
            this.draft.outputs = [{ outputId: 1, name: "Value", value: "" }]
            return
        }
        if (this.draft.kind === NG.NODE_FOR_EACH_GET_VAR) {
            this.draft.inputs = Array.isArray(this.draft.inputs) ? this.draft.inputs : []
            this.draft.outputs = this.draft.inputs.map((input, index) => ({
                outputId: Number(input.inputId || index + 1), name: String(input.name || "").trim(), value: "",
            }))
            return
        }
        if (this.draft.kind === NG.NODE_FOR_EACH_SET_VAR) {
            this.draft.inputs = Array.isArray(this.draft.inputs) ? this.draft.inputs : []
            this.draft.outputs = []
            return
        }
        if (this.draft.kind === NG.NODE_ITERATION_CONTROL) {
            this.draft.inputs = ["Skip", "Break"].map((name, index) => ({ inputId: index + 1, name, value: "" }))
            this.draft.outputs = []
            return
        }
        if (this.draft.kind === NG.NODE_GRAPH_INPUT) {
            this.draft.inputs = []
            this.draft.outputs = [{ outputId: 1, name: this.draft.name, value: "" }]
            return
        }
        if (this.draft.kind === NG.NODE_GRAPH_OUTPUT) {
            this.draft.inputs = [{ inputId: 1, name: this.draft.name, value: "" }]
            this.draft.outputs = []
            return
        }

        if (!nodeSupportsInputs(this.draft.kind)) {
            this.draft.inputs = []
            this.draft.newInputName = ""
        } else if (!Array.isArray(this.draft.inputs) || this.draft.inputs.length === 0) {
            this.draft.inputs = []
        }

        if (!nodeSupportsOutputs(this.draft.kind)) {
            this.draft.outputs = []
            this.draft.newOutputName = ""
            this.draft.newOutputValue = ""
        } else if (!Array.isArray(this.draft.outputs) || this.draft.outputs.length === 0) {
            this.draft.outputs = this.draft.kind === NG.NODE_VALUE ? [{ outputId: 1, name: "", value: "" }] : []
        }

        if (this.draft.kind === NG.NODE_CODE && !this.draft.codePath) {
            this.draft.codeReadOnly = true
            this.draft.codeStatus = this.draft.codeStatus || "Choose a code file to edit."
        }
    }

    renderNodeTypeOptions(selectedKind, selectedTemplateName = "") {
        const selected = selectedTemplateName ? `template:${selectedTemplateName}` : kindToFormValue(selectedKind)
        const groups = new Map()
        for (const entry of this.templates) {
            const group = String(entry.group || "Presets").trim() || "Presets"
            if (!groups.has(group)) groups.set(group, [])
            groups.get(group).push(entry)
        }
        const orderedGroups = [
            ...Array.from(groups.keys())
                .filter((group) => group !== "Presets")
                .sort((a, b) => a.localeCompare(b)),
            ...(groups.has("Presets") ? ["Presets"] : []),
        ]
        const templateOptions = orderedGroups.length
            ? orderedGroups
                  .map(
                      (group) => `<optgroup label="${escapeAttribute(group)}">
        ${groups
            .get(group)
            .map((entry) => {
                const value = `template:${entry.name}`
                return `<option value="${escapeAttribute(value)}" ${selected === value ? "selected" : ""}>${escapeAttribute(entry.name)}</option>`
            })
            .join("")}
      </optgroup>`,
                  )
                  .join("")
            : '<optgroup label="Presets"><option value="template-empty" disabled>empty</option></optgroup>'
        return `
      <optgroup label="Base">
        <option value="value" ${selected === "value" ? "selected" : ""}>value</option>
        <option value="code" ${selected === "code" ? "selected" : ""}>code</option>
        ${!this.popupProps.insideForEach ? `<option value="goal" ${selected === "goal" ? "selected" : ""}>goal</option>` : ""}
        <option value="group" ${selected === "group" ? "selected" : ""}>group</option>
        <option value="for-each" ${selected === "for-each" ? "selected" : ""}>for each</option>
        ${Number(this.popupProps.childGraphOwnerKind || 0) === NG.NODE_GROUP ? `<option value="input" ${selected === "input" ? "selected" : ""}>input</option>` : ""}
        ${[NG.NODE_GROUP, NG.NODE_FOR_EACH].includes(Number(this.popupProps.childGraphOwnerKind || 0)) ? `<option value="output" ${selected === "output" ? "selected" : ""}>output</option>` : ""}
        ${Number(this.popupProps.childGraphOwnerKind || 0) === NG.NODE_FOR_EACH ? `<option value="for-each-input" ${selected === "for-each-input" ? "selected" : ""}>input</option><option value="for-each-shared-input" ${selected === "for-each-shared-input" ? "selected" : ""}>shared input</option><option value="for-each-get-var" ${selected === "for-each-get-var" ? "selected" : ""}>get var</option><option value="for-each-set-var" ${selected === "for-each-set-var" ? "selected" : ""}>set var</option><option value="iteration-control" ${selected === "iteration-control" ? "selected" : ""}>iteration control</option>` : ""}
      </optgroup>
      ${templateOptions}
    `
    }

    renderCodeSourceFields() {
        const message = String(this.draft.codeStatus || "").trim()
        return `
      <fieldset>
        <legend>Code file</legend>
        <label>
          Path
          <input type="text" name="code-path" data-field="code-path" value="${escapeAttribute(this.draft.codePath)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="demo/ng/presets/example.lua">
        </label>
        <div role="buttongroup">
          <button type="button" data-action="browse-code-file">Browse</button>
          <button type="button" data-action="edit-code-file">Edit</button>
        </div>
        ${message ? `<output class="warning">${escapeAttribute(message)}</output>` : ""}
      </fieldset>
    `
    }

    renderPortRows(direction) {
        const isInput = direction === "input"
        const isValueNode = this.draft.kind === NG.NODE_VALUE
        const ports = isInput ? this.draft.inputs : this.draft.outputs
        return ports
            .map(
                (port, index) => `
      <tr>
        <td>${Number(isInput ? port.inputId : port.outputId || index + 1)}</td>
        <td>
          ${
              isInput
                  ? `<input type="hidden" name="input-port-id" value="${Number(port.inputId || index + 1)}"><input type="text" name="input-port-name" data-port-id="${Number(port.inputId || index + 1)}" value="${escapeAttribute(port.name || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Input ${index + 1}">`
                  : isValueNode
                    ? `<input type="hidden" name="output-port-id" value="${Number(port.outputId || index + 1)}"><input type="text" name="output-port-value" data-port-id="${Number(port.outputId || index + 1)}" value="${escapeAttribute(port.value || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Value ${index + 1}">`
                    : `<input type="hidden" name="output-port-id" value="${Number(port.outputId || index + 1)}"><input type="text" name="output-port-name" data-port-id="${Number(port.outputId || index + 1)}" value="${escapeAttribute(port.name || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Output ${index + 1}">`
}
        </td>
        <td><button type="button" data-action="${isInput ? "remove-input" : "remove-output"}" data-port-id="${Number(isInput ? port.inputId : port.outputId || index + 1)}" aria-label="Delete"><i aria-hidden="true">delete</i></button></td>
      </tr>
    `,
            )
            .join("")
    }

    renderForm() {
        const isEdit = this.mode === "edit"
        const isCodeNode = this.draft.kind === NG.NODE_CODE
        const isValueNode = this.draft.kind === NG.NODE_VALUE

        this.formElement.innerHTML = `
      ${isEdit ? `<output data-element="node-id">Node #${this.nodeId}</output>` : "<p>Add a new node.</p>"}
      <label>
        Type
        <select name="node-kind" ${isEdit ? "disabled" : ""}>
          ${this.renderNodeTypeOptions(this.draft.kind, this.draft.templateName)}
        </select>
      </label>
      <label>
        Node name
        <input type="text" data-field="name" name="name" placeholder="Enter node name" value="${escapeAttribute(this.draft.name)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      </label>
      ${isCodeNode ? this.renderCodeSourceFields() : ""}
      ${
          nodeSupportsInputs(this.draft.kind) && this.draft.kind !== NG.NODE_GRAPH_OUTPUT
              ? `
      <fieldset>
        <legend>Inputs</legend>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th></th></tr></thead>
          <tbody>${this.renderPortRows("input")}
            <tr>
              <td>New</td>
              <td><input type="text" name="new-input-name" value="${escapeAttribute(this.draft.newInputName)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Input name"></td>
              <td><button type="button" data-action="add-input" ${String(this.draft.newInputName).trim() ? "" : "disabled"}><i aria-hidden="true">add</i></button></td>
            </tr>
          </tbody>
        </table>
      </fieldset>`
              : ""
}
      ${
          nodeSupportsOutputs(this.draft.kind) && this.draft.kind !== NG.NODE_GRAPH_INPUT
              ? `
      <fieldset>
        <legend>Outputs</legend>
        <table>
          <thead><tr><th>ID</th><th>${isValueNode ? "Value" : "Name"}</th><th></th></tr></thead>
          <tbody>${this.renderPortRows("output")}
            <tr>
              <td>New</td>
              <td><input type="text" name="${isValueNode ? "new-output-value" : "new-output-name"}" value="${escapeAttribute(isValueNode ? this.draft.newOutputValue : this.draft.newOutputName)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${isValueNode ? "Value" : "Output name"}"></td>
              <td><button type="button" data-action="add-output" ${!isValueNode && !String(this.draft.newOutputName).trim() ? "disabled" : ""}><i aria-hidden="true">add</i></button></td>
            </tr>
          </tbody>
        </table>
      </fieldset>`
              : ""
}
      <footer>
        <output data-element="status"></output>
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" name="intent" value="${isEdit ? "save-node" : "create-node"}" class="accent">${isEdit ? "Apply" : "Create"}</button>
      </footer>
    `

        this.statusOutput = this.querySelector('[data-element="status"]')
        assert(this.statusOutput instanceof HTMLOutputElement, "view-ng-node missing status output")

        this.querySelector('[data-action="cancel"]')?.addEventListener("click", async () => {
            unwrap(
                await runtime.call("ui.popup.close", {
                    cancelled: true,
                    ok: false,
                    mode: this.mode,
                    nodeId: this.nodeId,
                }),
            )
        })

        const kindSelect = this.querySelector('[name="node-kind"]')
        if (kindSelect instanceof HTMLSelectElement && !isEdit) {
            kindSelect.onchange = async () => {
                this.captureDraftFromForm()
                const selectedValue = String(kindSelect.value || "")
                if (selectedValue.startsWith("template:")) {
                    const templateName = selectedValue.slice("template:".length).trim()
                    const templateEntry = this.templates.find((entry) => String(entry.name || "") === templateName)
                    if (!templateEntry) {
                        this.setStatus(`Template '${templateName}' was not found.`, "warning")
                        return
                    }
                    this.applyNodeTemplateToDraft(templateEntry)
                    this.renderForm()
                    return
                }
                const previousKind = this.draft.kind
                this.draft.kind = kindFromFormValue(selectedValue, this.draft.kind)
                this.draft.templateName = ""
                if (this.draft.kind !== previousKind) this.ensureDraftShape()
                this.renderForm()
            }
        }

        this.querySelector('[data-action="browse-code-file"]')?.addEventListener("click", async () => {
            await this.handleAction("browse-code-file")
        })
        this.querySelector('[data-action="edit-code-file"]')?.addEventListener("click", async () => {
            await this.handleAction("edit-code-file")
        })
        this.querySelector('[data-action="add-input"]')?.addEventListener("click", async () => {
            await this.handleAction("add-input")
        })
        this.querySelector('[data-action="add-output"]')?.addEventListener("click", async () => {
            await this.handleAction("add-output")
        })
        this.querySelectorAll('[data-action="remove-input"]').forEach((button) => {
            button.addEventListener("click", async () => {
                assert(button instanceof HTMLButtonElement, "view-ng-node remove input action must be a button")
                await this.handleAction(`remove-input:${String(button.dataset.portId || "")}`)
            })
        })
        this.querySelectorAll('[data-action="remove-output"]').forEach((button) => {
            button.addEventListener("click", async () => {
                assert(button instanceof HTMLButtonElement, "view-ng-node remove output action must be a button")
                await this.handleAction(`remove-output:${String(button.dataset.portId || "")}`)
            })
        })

        const newInput = this.querySelector('[name="new-input-name"]')
        const addInput = this.querySelector('[data-action="add-input"]')
        if (newInput instanceof HTMLInputElement && addInput instanceof HTMLButtonElement) {
            newInput.addEventListener("input", () => {
                this.captureDraftFromForm()
                addInput.disabled = !String(newInput.value || "").trim()
                if (!String(newInput.value || "").trim()) return
                const inputId = this.addInputPort(newInput.value)
                this.renderForm()
                this.focusPortInput("input", inputId)
            })
        }

        const newOutputName = this.querySelector('[name="new-output-name"]')
        const addOutput = this.querySelector('[data-action="add-output"]')
        if (newOutputName instanceof HTMLInputElement && addOutput instanceof HTMLButtonElement && !isValueNode) {
            newOutputName.addEventListener("input", () => {
                this.captureDraftFromForm()
                addOutput.disabled = !String(newOutputName.value || "").trim()
                if (!String(newOutputName.value || "").trim()) return
                const outputId = this.addOutputPort(newOutputName.value, "")
                this.renderForm()
                this.focusPortInput("output", outputId)
            })
        }

        const newOutputValue = this.querySelector('[name="new-output-value"]')
        if (newOutputValue instanceof HTMLInputElement && addOutput instanceof HTMLButtonElement && isValueNode) {
            newOutputValue.addEventListener("input", () => {
                this.captureDraftFromForm()
                if (!String(newOutputValue.value || "").length) return
                const outputId = this.addOutputPort("", newOutputValue.value)
                this.renderForm()
                this.focusPortInput("output", outputId)
            })
        }
    }

    captureDraftFromForm() {
        const formData = new FormData(this.formElement)
        this.draft.name = String(formData.get("name") || "").trim()
        if (this.draft.kind === NG.NODE_CODE) this.draft.codePath = String(formData.get("code-path") || "").trim()
        this.draft.newInputName = String(formData.get("new-input-name") || "")
        this.draft.newOutputName = String(formData.get("new-output-name") || "")
        this.draft.newOutputValue = String(formData.get("new-output-value") || "")

        const nextInputs = []
        const inputIds = formData.getAll("input-port-id")
        const inputNames = formData.getAll("input-port-name")
        for (let i = 0; i < inputIds.length; i += 1) {
            const inputId = Number(inputIds[i])
            if (!Number.isFinite(inputId)) continue
            nextInputs.push({
                inputId,
                name: String(inputNames[i] || "").trim(),
                value: "",
            })
        }

        const nextOutputs = []
        const outputIds = formData.getAll("output-port-id")
        const outputNames = formData.getAll("output-port-name")
        const outputValues = formData.getAll("output-port-value")
        for (let i = 0; i < outputIds.length; i += 1) {
            const outputId = Number(outputIds[i])
            if (!Number.isFinite(outputId)) continue
            nextOutputs.push({
                outputId,
                name: String(outputNames[i] || "").trim(),
                value: String(outputValues[i] || ""),
            })
        }

        this.draft.inputs = nextInputs
        this.draft.outputs = this.draft.kind === NG.NODE_FOR_EACH_GET_VAR
            ? nextInputs.map((input) => ({ outputId: input.inputId, name: input.name, value: "" }))
            : nextOutputs
    }

    addInputPort(name) {
        const inputName = String(name || "").trim()
        assert(inputName, "view-ng-node cannot add an unnamed input port")
        const nextId = this.draft.inputs.reduce((max, port) => Math.max(max, Number(port.inputId || 0)), 0) + 1
        this.draft.inputs.push({ inputId: nextId, name: inputName, value: "" })
        this.draft.newInputName = ""
        return nextId
    }

    addOutputPort(name, value) {
        const outputName = String(name || "").trim()
        const outputValue = String(value || "")
        assert(this.draft.kind === NG.NODE_VALUE || outputName, "view-ng-node cannot add an unnamed output port")
        const nextId = this.draft.outputs.reduce((max, port) => Math.max(max, Number(port.outputId || 0)), 0) + 1
        this.draft.outputs.push({
            outputId: nextId,
            name: outputName,
            value: outputValue,
        })
        this.draft.newOutputName = ""
        this.draft.newOutputValue = ""
        return nextId
    }

    focusPortInput(direction, portId) {
        const selector =
            direction === "input"
                ? `[name="input-port-name"][data-port-id="${Number(portId)}"]`
                : this.draft.kind === NG.NODE_VALUE
                  ? `[name="output-port-value"][data-port-id="${Number(portId)}"]`
                  : `[name="output-port-name"][data-port-id="${Number(portId)}"]`
        const input = this.querySelector(selector)
        assert(input instanceof HTMLInputElement, "view-ng-node missing newly-created port input")
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
    }

    async handleAction(intent) {
        this.captureDraftFromForm()

        if (intent === "add-input") {
            if (String(this.draft.newInputName || "").trim()) this.addInputPort(this.draft.newInputName)
            this.renderForm()
            return
        }

        if (intent.startsWith("remove-input:")) {
            const inputId = Number(intent.split(":")[1])
            this.draft.inputs = this.draft.inputs.filter((port) => Number(port.inputId) !== inputId)
            this.renderForm()
            return
        }

        if (intent === "add-output") {
            if (this.draft.kind === NG.NODE_VALUE || String(this.draft.newOutputName || "").trim()) {
                this.addOutputPort(this.draft.newOutputName, this.draft.newOutputValue)
            }
            this.renderForm()
            return
        }

        if (intent.startsWith("remove-output:")) {
            const outputId = Number(intent.split(":")[1])
            this.draft.outputs = this.draft.outputs.filter((port) => Number(port.outputId) !== outputId)
            this.renderForm()
            return
        }

        if (intent === "browse-code-file") {
            try {
                const selected = await this.chooseCodeFile()
                if (selected) this.draft.codeStatus = ""
            } catch (error) {
                this.draft.codeStatus = String(error?.message || error)
            }
            this.renderForm()
            return
        }

        if (intent === "edit-code-file") {
            if (!this.draft.codePath) {
                this.draft.codeStatus = "Choose a code file path first."
                this.renderForm()
                return
            }
            try {
                const payload = unwrap(
                    await runtime.call("ui.popup.open", {
                        title: "Edit Code",
                        size: "large",
                        tag: "view-code",
                        attributes: { "data-source": this.draft.codePath },
                    }),
                )
                this.draft.codeStatus = payload?.ok ? "Code file saved." : ""
            } catch (error) {
                this.draft.codeStatus = String(error?.message || error)
            }
            this.renderForm()
            return
        }

        throw new Error(`view-ng-node unknown action: ${intent}`)
    }

    applyNodeTemplateToDraft(templateEntry) {
        const payload = normalizeTemplatePayload(templateEntry?.data, Number(templateEntry?.kind || NG.NODE_CODE))
        this.draft.kind = payload.kind
        this.draft.templateName = String(templateEntry?.name || "").trim()
        this.draft.name = payload.name
        if (payload.kind === NG.NODE_CODE) {
            this.draft.codePath = payload.codePath
            this.draft.code = payload.code
            this.draft.codeReadOnly = payload.codeReadOnly
            this.draft.codeStatus = payload.codeStatus
        } else {
            delete this.draft.codePath
            delete this.draft.code
            delete this.draft.codeReadOnly
            delete this.draft.codeStatus
        }
        this.draft.newInputName = ""
        this.draft.newOutputName = ""
        this.draft.newOutputValue = ""
        this.draft.inputs = payload.inputs
        this.draft.outputs = payload.outputs
        this.draft.storage = payload.kind === NG.NODE_GROUP ? structuredClone(payload.storage) : undefined
        this.draft.childGraph = payload.childGraph === undefined ? undefined : structuredClone(payload.childGraph)
    }

    async chooseCodeFile() {
        const payload = unwrap(
            await runtime.call("ui.popup.open", {
                title: "Choose Code File",
                size: "large",
                tag: "view-files",
                props: {
                    mode: "chooser",
                    rootPath: dirname(this.draft.codePath),
                    filter: "*.lua",
                },
            }),
        )
        if (payload?.cancelled) return false
        const selection = payload?.selection
        if (!selection || Array.isArray(selection)) return false
        this.draft.codePath = String(selection.path || "").trim()
        return Boolean(this.draft.codePath)
    }

    setStatus(text, tone = null) {
        this.statusOutput.textContent = text
        this.statusOutput.classList.remove("accent", "success", "warning", "danger", "info")
        if (tone) this.statusOutput.classList.add(tone)
    }

    async handleSubmit(event) {
        this.captureDraftFromForm()
        const submitter = event.submitter
        const formData = new FormData(this.formElement, submitter || undefined)
        const intent = formData.has("remove-input-id")
            ? `remove-input:${String(formData.get("remove-input-id") || "")}`
            : formData.has("remove-output-id")
              ? `remove-output:${String(formData.get("remove-output-id") || "")}`
              : String(formData.get("intent") || (this.mode === "edit" ? "save-node" : "create-node"))

        if (intent === "add-input") {
            const inputName = String(formData.get("new-input-name") || "").trim()
            if (inputName) {
                const nextId = this.draft.inputs.reduce((max, port) => Math.max(max, Number(port.inputId || 0)), 0) + 1
                this.draft.inputs.push({ inputId: nextId, name: inputName, value: "" })
                this.draft.newInputName = ""
            }
            this.renderForm()
            return
        }

        if (intent.startsWith("remove-input:")) {
            const inputId = Number(intent.split(":")[1])
            this.draft.inputs = this.draft.inputs.filter((port) => Number(port.inputId) !== inputId)
            this.renderForm()
            return
        }

        if (intent === "add-output") {
            const outputName = String(formData.get("new-output-name") || "").trim()
            const outputValue = String(formData.get("new-output-value") || "")
            if (this.draft.kind === NG.NODE_VALUE || outputName) {
                const nextId =
                    this.draft.outputs.reduce((max, port) => Math.max(max, Number(port.outputId || 0)), 0) + 1
                this.draft.outputs.push({
                    outputId: nextId,
                    name: outputName,
                    value: outputValue,
                })
                this.draft.newOutputName = ""
                this.draft.newOutputValue = ""
            }
            this.renderForm()
            return
        }

        if (intent.startsWith("remove-output:")) {
            const outputId = Number(intent.split(":")[1])
            this.draft.outputs = this.draft.outputs.filter((port) => Number(port.outputId) !== outputId)
            this.renderForm()
            return
        }

        if (intent === "browse-code-file") {
            try {
                const selected = await this.chooseCodeFile()
                if (selected) this.draft.codeStatus = ""
            } catch (error) {
                this.draft.codeStatus = String(error?.message || error)
            }
            this.renderForm()
            return
        }

        if (intent === "edit-code-file") {
            if (!this.draft.codePath) {
                this.draft.codeStatus = "Choose a code file path first."
                this.renderForm()
                return
            }
            try {
                const payload = unwrap(
                    await runtime.call("ui.popup.open", {
                        title: "Edit Code",
                        size: "large",
                        tag: "view-code",
                        attributes: { "data-source": this.draft.codePath },
                    }),
                )
                this.draft.codeStatus = payload?.ok ? "Code file saved." : ""
            } catch (error) {
                this.draft.codeStatus = String(error?.message || error)
            }
            this.renderForm()
            return
        }

        if (this.mode === "edit") {
            unwrap(
                await runtime.call("ui.popup.close", {
                    ok: true,
                    cancelled: false,
                    mode: this.mode,
                    nodeId: this.nodeId,
                    draft: {
                        kind: Number(this.draft.kind || NG.NODE_CODE),
                        name: String(this.draft.name || "").trim(),
                        ...(this.draft.kind === NG.NODE_CODE ? {
                            codePath: String(this.draft.codePath || "").trim(),
                            code: String(this.draft.code || ""),
                        } : {}),
                        ...(this.draft.kind === NG.NODE_GROUP ? { storage: structuredClone(this.draft.storage || { mode: "inline" }) } : {}),
                        childGraph: this.draft.kind === NG.NODE_FOR_EACH || (this.draft.kind === NG.NODE_GROUP && (this.draft.storage?.mode || "inline") === "inline") ? structuredClone(this.draft.childGraph || []) : undefined,
                        inputs: this.draft.inputs.map((port, index) => ({
                            inputId: Number(port.inputId || index + 1),
                            name: String(port.name || "").trim(),
                            value: String(port.value || ""),
                        })),
                        outputs: this.draft.outputs.map((port, index) => ({
                            outputId: Number(port.outputId || index + 1),
                            name: String(port.name || "").trim(),
                            value: String(port.value || ""),
                        })),
                    },
                }),
            )
            return
        }

        unwrap(
            await runtime.call("ui.popup.close", {
                ok: true,
                cancelled: false,
                mode: this.mode,
                draft: {
                    kind: Number(this.draft.kind || NG.NODE_CODE),
                    templateName: String(this.draft.templateName || ""),
                    name: String(this.draft.name || "").trim(),
                    ...(this.draft.kind === NG.NODE_CODE ? {
                        codePath: String(this.draft.codePath || "").trim(),
                        code: String(this.draft.code || ""),
                    } : {}),
                    ...(this.draft.kind === NG.NODE_GROUP ? { storage: structuredClone(this.draft.storage || { mode: "inline" }) } : {}),
                    childGraph: this.draft.kind === NG.NODE_FOR_EACH || (this.draft.kind === NG.NODE_GROUP && (this.draft.storage?.mode || "inline") === "inline") ? structuredClone(this.draft.childGraph || []) : undefined,
                    inputs: this.draft.inputs.map((port, index) => ({
                        inputId: Number(port.inputId || index + 1),
                        name: String(port.name || "").trim(),
                        value: String(port.value || ""),
                    })),
                    outputs: this.draft.outputs.map((port, index) => ({
                        outputId: Number(port.outputId || index + 1),
                        name: String(port.name || "").trim(),
                        value: String(port.value || ""),
                    })),
                },
            }),
        )
    }

    disconnectedCallback() {
        void unregisterViewPlugin(this)
    }
}

if (!customElements.get("view-ng-node")) {
    customElements.define("view-ng-node", ViewNgNode)
}
