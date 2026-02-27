

import { NgModule, inject } from '@angular/core'
import { type HttpClient } from '@angular/common/http'
import { OverlayContainer } from '@angular/cdk/overlay'
import { TranslateHttpLoader } from '@ngx-translate/http-loader'
import { ConfigurationService } from './Services/configuration.service'

export function HttpLoaderFactory (http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json')
}

@NgModule()
export class AppModule {
  configurationService = inject(ConfigurationService);
  overlayContainer = inject(OverlayContainer);

  constructor () {
    const configurationService = this.configurationService;
    const overlayContainer = this.overlayContainer;

    configurationService.getApplicationConfiguration().subscribe((conf) => {
      overlayContainer.getContainerElement().classList.add(conf.application.theme + '-theme')
    })
  }
}
