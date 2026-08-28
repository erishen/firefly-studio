import { Component } from 'react'

// 模型加载出错（如国内网络拉不动 RPM CDN）时，回退到 children 之外的 fallback
export default class ModelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: false }
  }

  static getDerivedStateFromError() {
    return { error: true }
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.warn('[AvatarModel] 加载失败，已回退到程序化角色：', error)
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children
  }
}
