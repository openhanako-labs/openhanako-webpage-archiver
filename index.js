export default class WebpageArchiverPlugin {
  async onload() {
    const { log } = this.ctx;
    log.info("网页存档器 loaded");
  }
}