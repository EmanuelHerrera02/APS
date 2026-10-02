ThisBuild / scalaVersion := "3.8.4"
ThisBuild / organization := "com.transport"
ThisBuild / version := "0.1.0-SNAPSHOT"

lazy val root = (project in file("."))
  .settings(
    name := "aeronet-backend",
    libraryDependencies ++= Seq(
      "org.scalatra" %% "scalatra-jakarta" % "3.1.2",
      "org.scalatra" %% "scalatra-json-jakarta" % "3.1.2",
      "org.json4s" %% "json4s-native" % "4.0.7",
      "org.json4s" %% "json4s-jackson" % "4.0.7",
      "com.password4j" % "password4j" % "1.8.4",
      "org.mariadb.jdbc" % "mariadb-java-client" % "3.5.1",
      "org.slf4j" % "slf4j-api" % "2.0.17",
      "ch.qos.logback" % "logback-classic" % "1.5.18" % Runtime,
      "jakarta.servlet" % "jakarta.servlet-api" % "6.0.0" % Provided
    )
  )
