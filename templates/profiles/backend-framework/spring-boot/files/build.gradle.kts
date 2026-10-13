plugins {
    java
{{gradle_plugins}}
}

group = "{{java_package}}"
version = "0.0.1"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of({{java_version}})
    }
}

dependencies {
{{gradle_dependencies}}
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

tasks.test {
    useJUnitPlatform()
}

{{gradle_check_tasks}}
