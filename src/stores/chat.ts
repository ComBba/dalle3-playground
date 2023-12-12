import { ImageGenerateParams } from 'openai/resources'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useConfigStore } from './config'
import { imageStore } from 'src/lib/image-persist'

export type ImageMeta = Pick<ImageGenerateParams, 'quality' | 'size' | 'style'>

export interface Message {
  type: 'user' | 'assistant'
  content: string
  isError: boolean
  isLoading?: boolean
  imageMeta?: ImageMeta
  timestamp: number
}

type ChatStore = {
  messages: Message[]
  isGenerating: boolean
  inputPrompt: string

  isShowingApiKeyDialog: boolean
  toggleApiKeyDialog: (value: boolean) => any

  isShowingSettingFormSheet: boolean
  toggleSettingFormSheet: (value: boolean) => any

  onInputChange: (message: string) => any
  addMessage: () => any
  fixBrokenMessage: () => any
  clearMessages: () => any
  cancelGeneration: () => any
}

let controller: AbortController

export const useChatStore = create(
  persist<ChatStore>(
    (set, get) => ({
      messages: [],
      isGenerating: false,
      inputPrompt: '',

      isShowingApiKeyDialog: false,
      toggleApiKeyDialog(value) {
        set({ isShowingApiKeyDialog: value })
      },

      isShowingSettingFormSheet: false,
      toggleSettingFormSheet(value) {
        set({ isShowingSettingFormSheet: value })
      },

      onInputChange(inputPrompt) {
        set(() => ({ inputPrompt }))
      },
      async addMessage() {
        const { style, size, quality } = useConfigStore.getState()
        const inputPrompt = get().inputPrompt

        if (!inputPrompt || get().isGenerating) return

        set(() => ({
          isGenerating: true,
          messages: [
            ...get().messages,
            { type: 'user', content: inputPrompt, isError: false, timestamp: Date.now() },
            { type: 'assistant', content: '', isError: false, isLoading: true, timestamp: Date.now() },
          ],
        }))

        try {
          // Create 3 promises for fetching images
          const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: inputPrompt, size, style, quality }),
          }

          console.log(`curl -X 'POST' \\
            'http://127.0.0.1:8000/generate-image' \\
            -H 'Content-Type: application/json' \\
            -d '${fetchOptions.body}'`)

          const imageFetchPromises = Array.from({ length: 3 }, () =>
            fetch('http://127.0.0.1:8000/generate-image', fetchOptions),
          )

          const responses = await Promise.all(imageFetchPromises)
          const imageKeys = await Promise.all(
            responses.map(async (response) => {
              if (!response.ok) throw new Error('Server error')
              const responseData = await response.json()
              const base64ImageData = responseData.data[0].b64_json // Extract base64 image data
              // Log response data excluding base64 image data
              console.log({
                ...responseData,
                data: [{ ...responseData.data[0], b64_json: `Length: ${base64ImageData.length} characters` }],
              })
              return await imageStore.storeImage(`data:image/png;base64,${base64ImageData}`)
            }),
          )

          const imageMeta = { style, size, quality }
          const imagesContent = imageKeys.join(', ')

          set(() => ({
            inputPrompt: '',
            messages: [
              ...get().messages.slice(0, -1),
              { type: 'assistant', content: imagesContent, imageMeta, isError: false, timestamp: Date.now() },
            ],
          }))
        } catch (error: any) {
          set(() => ({
            messages: [
              ...get().messages.slice(0, -1),
              { type: 'assistant', content: error.message || 'Unknown error', isError: true, timestamp: Date.now() },
            ],
          }))
          console.error(error)
        } finally {
          set(() => ({ isGenerating: false }))
        }
      },
      cancelGeneration() {
        controller?.abort()
        set(() => ({ isGenerating: false }))
      },
      fixBrokenMessage() {
        const lastMessage = get().messages[get().messages.length - 1]
        if (lastMessage?.isLoading) {
          set(() => ({
            messages: get().messages.slice(0, -1),
          }))
        }
      },
      clearMessages() {
        set(() => ({ messages: [] }))
        imageStore.clear()
      },
    }),
    {
      name: 'chat-store',
      //@ts-ignore TODO:
      partialize: (state) => ({ messages: state.messages }),
    },
  ),
)
