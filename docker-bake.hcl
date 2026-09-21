variable "IMAGE" {
  default = "chaingraph"
}

variable "VERSION" {
  default = "local"
}

variable "CHAINGRAPH_SOURCE_URL" {
  default = ""
}

variable "VCS_REF" {
  default = ""
}

variable "SOURCE_DATE_EPOCH" {
  default = "0"
}

variable "PUBLISH" {
  default = "false"
}

target "_image" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    CHAINGRAPH_SOURCE_URL = CHAINGRAPH_SOURCE_URL
    VCS_REF                = VCS_REF
    SOURCE_DATE_EPOCH      = SOURCE_DATE_EPOCH
  }
  tags = ["${IMAGE}:${VERSION}"]
  output = [
    "type=image,oci-mediatypes=true,compression=gzip,compression-level=6,rewrite-timestamp=true,compatibility-version=20,push=${PUBLISH},push-by-digest=true,name-canonical=true",
  ]
  attest = ["type=provenance,disabled=true"]
}

target "release-platform" {
  inherits  = ["_image"]
  platforms = [BAKE_LOCAL_PLATFORM]
}

target "reproduce" {
  inherits  = ["_image"]
  platforms = [BAKE_LOCAL_PLATFORM]
}
