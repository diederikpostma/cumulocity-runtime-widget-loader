/*
* Copyright (c) 2020 Software AG, Darmstadt, Germany and/or its licensors
*
* SPDX-License-Identifier: Apache-2.0
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*    http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
 */

import {Injectable, Injector, isDevMode} from "@angular/core";
import { ApplicationService, IApplication } from "@c8y/client";
import * as JSZip from "jszip";

export function contextPathFromURL() {
    return window.location.pathname.match(/\/apps\/(.*?)\//)[1];
}

@Injectable({providedIn: 'root'})
export class RuntimeWidgetInstallerService {
    private appService: ApplicationService;
    constructor(injector: Injector) {
        // Work around angular/typescript compiler issue...
        // When we put the ApplicationService as an injection token then the compiler generates an import from @c8y/client/lib/src/ApplicationService
        // This seems to only happen when providedIn: root is used...
        // We want to use providedIn: root so that this service is tree-shaken
        this.appService = injector.get(ApplicationService);
    }

    /**
     * Installs a widget into the current application
     * Step1: Deploy widget as an application to the tenant (if it doesn't already exist)
     * Step2: Update the current application's cumulocity json to include the new widget (in widgetContextPaths array)
     * @param widgetFile
     * @param onUpdate
     */
    async installWidget(widgetFile: Blob, onUpdate: (msg: string) => void = ()=>{}) {
        // Check if we're debugging or on localhost - updating the app's cumulocity.json won't work when debugging on localhost so don't do anything
        const currentHost = window.location.host.split(':')[0];
        if (isDevMode() || currentHost === 'localhost' || currentHost === '127.0.0.1') {
            throw Error("Can't add a widget when running in Development Mode. Deploy the application first, or edit the package.json file.");
        }

        // Step1: Deploy widget as an application to the tenant (if it doesn't already exist)

        // Get the widget's c8yJson so that we can read the context-path (to check if it is already deployed)
        let widgetC8yJson;
        try {
            const widgetFileZip = await JSZip.loadAsync(widgetFile);
            widgetC8yJson = JSON.parse(await widgetFileZip.file('cumulocity.json').async("text"));
            if (widgetC8yJson.contextPath === undefined) {
                // noinspection ExceptionCaughtLocallyJS
                throw Error("Widget has no context path");
            }
        } catch (e) {
            console.log(e);
            throw Error("Not a valid widget");
        }

        const appList = (await this.appService.list({pageSize: 2000})).data;

        // Deploy the widget
        if (appList.some(app => app.contextPath === widgetC8yJson.contextPath)) {
            onUpdate("Widget already deployed! Adding to Application...\n You can update a widget via the Apps Administration screen.");
        } else {
            // Create the widget's app
            const widgetApp = (await this.appService.create({
                ...widgetC8yJson,
                resourcesUrl: "/",
                type: "HOSTED"
            } as any)).data;

            // Upload the binary
            const appBinary = (await this.appService.binary(widgetApp).upload(widgetFile)).data;

            // Update the app
            await this.appService.update({
                id: widgetApp.id,
                activeVersionId: appBinary.id.toString()
            });
            onUpdate("Widget deployed! Adding to application...");
        }

        // Step 2: Update the app's cumulocity.json to include the new widget

        // find the current app
        const app: IApplication & {widgetContextPaths?: string[]} = appList.find(app => app.contextPath === contextPathFromURL());
        if (!app) {
            throw Error('Could not find current application');
        }

        // Create a unique list of all the widgets in the app
        const widgetContextPaths = Array.from(new Set([
            ...app.widgetContextPaths || [],
            widgetC8yJson.contextPath
        ]));

        // Update the application with the new widget context path list
        await this.appService.update({
            id: app.id,
            widgetContextPaths
        } as IApplication);
    }
}
