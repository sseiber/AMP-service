# AMP client-demo service

## Dependencies
  * Node
  * NPM
  * Docker

## Install
  * This repository depends on the [AMP-client](https://github.com/sseiber/AMP-client) repository as a peer
  * Clone this repository
  * npm i
  * update ./configs/local.json environment variables
  * update ./configs/imageConfig.json docker image name and target architecture
  * Run (F5)

## Development
  * **test:**  
  `npm run test`  

  * **lint:**  
  `npm run tslint`  

  * **build a new version:**  
  `npm version [major|minor|patch] [--force]`  
  *this assumes access to the container registry for the image being built*
