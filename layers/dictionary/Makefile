# The layer's build method, and it is NOT optional.
#
# "No build method: the content is a committed file, not compiled" is not a valid skip.
# .github/workflows/pipeline.yaml runs `sam build --use-container` over the whole template, and a
# LayerVersion referenced by a function being built with no `Metadata: BuildMethod` is a hard
# MissingBuildMethodException -- the build fails, it does not silently skip the layer.
#
# The makefile method is chosen over a runtime method because a runtime method runs the Node builder
# and wants a package.json this layer has no reason to have.
#
# The target name is build-<LogicalId>, so build-DictionaryLayer, and SAM sets ARTIFACTS_DIR.
# ContentUri: layers/dictionary with the file at layers/dictionary/dictionary/v1.txt yields
# /opt/dictionary/v1.txt at runtime, which is what DICTIONARY_PATH points at.
build-DictionaryLayer:
	mkdir -p "$(ARTIFACTS_DIR)/dictionary"
	cp dictionary/*.txt "$(ARTIFACTS_DIR)/dictionary/"
