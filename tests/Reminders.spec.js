import { mount } from '@vue/test-utils'
import Reminders from '@/components/Reminders.vue'

// Basic smoke test to ensure the component mounts and renders the heading.
describe('Reminders.vue', () => {
  it('renders the Reminders heading', () => {
    const wrapper = mount(Reminders)
    const h1 = wrapper.find('h1')
    expect(h1.exists()).toBe(true)
    expect(h1.text()).toBe('Reminders')
  })
})
