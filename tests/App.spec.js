import { mount } from '@vue/test-utils'
import App from '@/App.vue'

describe('App.vue', () => {
  it('renders the app title', () => {
    const wrapper = mount(App)
    const h1 = wrapper.find('header .title')
    expect(h1.exists()).toBe(true)
    expect(h1.text()).toBe('AngelVoice')
  })
})
