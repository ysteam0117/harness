plugins {
    java
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of({{java_version}})
    }
}

dependencies {
{{gradle_dependencies}}
}

{{gradle_check_tasks}}
