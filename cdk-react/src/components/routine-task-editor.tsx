import Editor, { type OnMount } from '@monaco-editor/react'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import type * as Monaco from 'monaco-editor'

export type RoutineTaskEditorHandle = {
  getValue: () => string
  setValue: (value: string) => void
}

type RoutineTaskEditorProps = {
  label: string
  language: 'python' | 'javascript'
  initialValue: string
  height?: number
}

export const RoutineTaskEditor = forwardRef<
  RoutineTaskEditorHandle,
  RoutineTaskEditorProps
>(function RoutineTaskEditor(
  {
    label,
    language,
    initialValue,
    height = 320,
  }: RoutineTaskEditorProps,
  ref,
) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => editorRef.current?.getValue() ?? initialValue,
      setValue: (nextValue: string) => {
        editorRef.current?.setValue(nextValue)
      },
    }),
    [initialValue],
  )

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="overflow-hidden border border-border bg-card">
        <Editor
          height={height}
          defaultLanguage={language}
          language={language}
          theme="vs-dark"
          defaultValue={initialValue}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  )
})
